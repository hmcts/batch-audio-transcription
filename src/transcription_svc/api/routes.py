import ipaddress
import json
import logging
import mimetypes
import re
import socket
from pathlib import PurePosixPath
from typing import Annotated
from urllib.parse import urlparse
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from transcription_svc.api.dependencies import get_caller
from transcription_svc.audio import local_storage
from transcription_svc.audio.azure_utils import AsyncAzureBlobManager
from transcription_svc.audio.submission import submit_and_queue_batch_job
from transcription_svc.config.settings import get_settings
from transcription_svc.database.engine import get_session
from transcription_svc.database.interface import (
    get_job_by_id,
    get_job_by_idempotency_key,
    list_jobs_for_caller,
)
from transcription_svc.database.models import Caller, JobStatus, TranscriptionJob

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")

_LOCALE_RE = re.compile(r"^[a-z]{2}-[A-Z]{2}$")
_METADATA_MAX_BYTES = 4096
_UPLOAD_SAS_EXPIRY_HOURS = 72
# ~200MB comfortably covers a multi-hour hearing at typical speech bitrates
# while bounding worst-case memory use for a single upload.
_MAX_UPLOAD_BYTES = 200 * 1024 * 1024
_UPLOAD_CHUNK_BYTES = 1024 * 1024
_ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".mp4", ".m4a", ".ogg", ".flac"}
_UNSAFE_FILENAME_CHARS_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def _sanitize_filename(filename: str) -> str:
    """Collapse anything outside [A-Za-z0-9_.-] to "_".

    Keeps blob names uniformly safe for both storage backends: predictable
    for the local dev backend's path-traversal allowlist, and free of
    characters that would need URL-escaping in the returned audio_url.
    """
    name = PurePosixPath(filename).name or "audio"
    return _UNSAFE_FILENAME_CHARS_RE.sub("_", name)


# Rate limiter — keyed on the bearer token so limits are per-caller, not per-IP.
# Falls back to remote address for unauthenticated requests.
def _caller_key(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    return auth[7:] if auth.startswith("Bearer ") else get_remote_address(request)


limiter = Limiter(key_func=_caller_key)


def _reject_private_url(url: str, field: str = "url") -> None:
    """Raise ValueError if url resolves to a private/internal address.

    Prevents SSRF: an attacker with valid credentials cannot point the
    service at the Azure metadata service (169.254.169.254), internal
    Postgres, or other VNet-internal hosts.
    Allowed in local environment to support docker-compose development.
    """
    if get_settings().ENVIRONMENT in ("local", "test"):
        return
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"{field} must use http or https")
    host = parsed.hostname or ""
    try:
        # getaddrinfo returns all A/AAAA records; reject if any resolves to a restricted range.
        results = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError(f"{field} hostname could not be resolved: {host}") from exc
    for _family, _type, _proto, _canonname, sockaddr in results:
        ip = ipaddress.ip_address(sockaddr[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError(f"{field} resolves to a private/internal address: {ip}")


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class SubmitJobRequest(BaseModel):
    audio_url: str
    locale: str = "en-GB"
    enable_diarization: bool = True
    callback_url: str | None = None
    idempotency_key: str | None = None
    metadata: dict = Field(default_factory=dict)

    @field_validator("audio_url")
    @classmethod
    def validate_audio_url(cls, v: str) -> str:
        _reject_private_url(v, "audio_url")
        return v

    @field_validator("locale")
    @classmethod
    def validate_locale(cls, v: str) -> str:
        if not _LOCALE_RE.match(v):
            raise ValueError("locale must be in the format 'en-GB'")
        return v

    @field_validator("metadata")
    @classmethod
    def validate_metadata_size(cls, v: dict) -> dict:
        if len(json.dumps(v, ensure_ascii=False).encode("utf-8")) > _METADATA_MAX_BYTES:
            raise ValueError(
                f"metadata must not exceed {_METADATA_MAX_BYTES} bytes when serialised"
            )
        return v

    @field_validator("callback_url")
    @classmethod
    def validate_callback_url(cls, v: str | None) -> str | None:
        if v is not None:
            _reject_private_url(v, "callback_url")
        return v

    @field_validator("idempotency_key")
    @classmethod
    def validate_idempotency_key(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 256:
            raise ValueError("idempotency_key must not exceed 256 characters")
        return v


class DialogueEntryResponse(BaseModel):
    speaker: str
    text: str
    start_time: float
    end_time: float


class JobResponse(BaseModel):
    job_id: UUID
    status: str
    created_at: str
    updated_at: str | None = None
    dialogue_entries: list[DialogueEntryResponse] | None = None
    error_message: str | None = None
    metadata: dict = Field(default_factory=dict)


class ListJobsResponse(BaseModel):
    jobs: list[JobResponse]
    total: int
    limit: int
    offset: int


class JobListResponse(BaseModel):
    jobs: list[JobResponse]


class UploadResponse(BaseModel):
    audio_url: str
    blob_name: str


def _to_response(job: TranscriptionJob) -> JobResponse:
    entries = None
    if job.status == JobStatus.SUCCEEDED and job.dialogue_entries:
        entries = [
            DialogueEntryResponse(
                speaker=e.get("speaker", "") if isinstance(e, dict) else e.speaker,
                text=e.get("text", "") if isinstance(e, dict) else e.text,
                start_time=e.get("start_time", 0.0) if isinstance(e, dict) else e.start_time,
                end_time=e.get("end_time", 0.0) if isinstance(e, dict) else e.end_time,
            )
            for e in job.dialogue_entries
        ]
    return JobResponse(
        job_id=job.id,
        status=job.status.value,
        created_at=job.created_datetime.isoformat(),
        updated_at=job.updated_datetime.isoformat() if job.updated_datetime else None,
        dialogue_entries=entries,
        error_message=job.error_message,
        metadata=job.metadata_,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


async def _read_upload_capped(file: UploadFile, max_bytes: int) -> bytes:
    """Read in chunks, aborting as soon as max_bytes is exceeded.

    Bounds worst-case memory use to roughly max_bytes rather than reading an
    arbitrarily oversized upload in a single call before checking its length.
    """
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_UPLOAD_CHUNK_BYTES):
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413, detail="Audio file exceeds the maximum upload size"
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/uploads", status_code=201, response_model=UploadResponse)
@limiter.limit("50/hour")
async def upload_audio(
    request: Request,
    file: UploadFile = File(...),
    caller: Caller = Depends(get_caller),
) -> UploadResponse:
    extension = PurePosixPath(file.filename or "").suffix.lower()
    if extension not in _ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{extension}'. "
            f"Allowed: {', '.join(sorted(_ALLOWED_AUDIO_EXTENSIONS))}",
        )

    content = await _read_upload_capped(file, _MAX_UPLOAD_BYTES)

    safe_filename = _sanitize_filename(file.filename or "audio")
    blob_name = f"uploads/{caller.id}/{uuid4()}-{safe_filename}"

    if get_settings().AUDIO_STORAGE_BACKEND == "local":
        local_storage.save(content, blob_name)
        try:
            audio_url = local_storage.build_url(blob_name)
        except ValueError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return UploadResponse(audio_url=audio_url, blob_name=blob_name)

    async with AsyncAzureBlobManager() as blob_manager:
        uploaded = await blob_manager.create_blob_from_bytes(content, blob_name)
        if not uploaded:
            raise HTTPException(status_code=502, detail="Failed to store audio file")
        audio_url = await blob_manager.generate_read_sas_url(
            blob_name, hours=_UPLOAD_SAS_EXPIRY_HOURS
        )

    return UploadResponse(audio_url=audio_url, blob_name=blob_name)


@router.get("/local-audio/{blob_name:path}")
async def get_local_audio(blob_name: str) -> Response:
    """Serve locally-stored audio — only active in AUDIO_STORAGE_BACKEND=local.

    Deliberately unauthenticated: Azure Speech Batch fetches contentUrls
    directly and cannot send our bearer token. Safe because (a) this route
    404s outright unless a developer has explicitly opted into local storage,
    which never happens in a deployed environment, and (b) blob names embed
    an unguessable UUID.
    """
    if get_settings().AUDIO_STORAGE_BACKEND != "local":
        raise HTTPException(status_code=404)

    try:
        content = local_storage.read(blob_name)
    except (FileNotFoundError, ValueError):
        raise HTTPException(status_code=404, detail="Audio file not found") from None

    media_type = mimetypes.guess_type(blob_name)[0] or "application/octet-stream"
    return Response(content=content, media_type=media_type)


@router.post("/jobs", status_code=201, response_model=JobResponse)
@limiter.limit("100/hour")
async def submit_job(
    request: Request,
    body: Annotated[SubmitJobRequest, Body()],
    session: Session = Depends(get_session),
    caller: Caller = Depends(get_caller),
) -> JobResponse:
    if body.idempotency_key:
        existing = get_job_by_idempotency_key(session, body.idempotency_key, caller.id)
        if existing:
            return _to_response(existing)

    try:
        job = await submit_and_queue_batch_job(
            session=session,
            audio_url=body.audio_url,
            caller_id=caller.id,
            locale=body.locale,
            enable_diarization=body.enable_diarization,
            callback_url=body.callback_url,
            idempotency_key=body.idempotency_key,
            metadata=body.metadata,
        )
    except IntegrityError:
        # Two concurrent requests with the same idempotency_key both passed the
        # check-then-act above; the second insert hit the unique constraint.
        # Roll back the failed transaction and return whatever the winner created.
        session.rollback()
        if body.idempotency_key:
            existing = get_job_by_idempotency_key(session, body.idempotency_key, caller.id)
            if existing:
                return _to_response(existing)
        raise HTTPException(
            status_code=409, detail="Concurrent submission conflict; retry"
        ) from None

    return _to_response(job)


@router.get("/jobs", response_model=ListJobsResponse)
async def list_jobs(
    session: Session = Depends(get_session),
    caller: Caller = Depends(get_caller),
    status: str | None = Query(default=None, description="Filter by job status"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ListJobsResponse:
    parsed_status: JobStatus | None = None
    if status is not None:
        try:
            parsed_status = JobStatus(status)
        except ValueError:
            valid = ", ".join(s.value for s in JobStatus)
            raise HTTPException(
                status_code=400, detail=f"Invalid status '{status}'. Valid values: {valid}"
            ) from None

    jobs, total = list_jobs_for_caller(session, caller.id, parsed_status, limit, offset)
    return ListJobsResponse(
        jobs=[_to_response(j) for j in jobs],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: UUID,
    session: Session = Depends(get_session),
    caller: Caller = Depends(get_caller),
) -> JobResponse:
    job = get_job_by_id(session, job_id)
    if not job or job.caller_id != caller.id:
        raise HTTPException(status_code=404, detail="Job not found")
    return _to_response(job)


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    job_id: UUID,
    session: Session = Depends(get_session),
    caller: Caller = Depends(get_caller),
) -> Response:
    job = get_job_by_id(session, job_id)
    if not job or job.caller_id != caller.id:
        raise HTTPException(status_code=404, detail="Job not found")
    session.delete(job)
    session.commit()
    return Response(status_code=204)
