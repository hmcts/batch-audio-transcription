from __future__ import annotations

import ipaddress
import json
import logging
import re
import socket
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from transcription_svc.api.dependencies import get_caller
from transcription_svc.audio.submission import submit_and_queue_batch_job
from transcription_svc.config.settings import get_settings
from transcription_svc.database.engine import get_session
from transcription_svc.database.interface import get_job_by_id, get_job_by_idempotency_key
from transcription_svc.database.models import Caller, JobStatus, TranscriptionJob

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")

_LOCALE_RE = re.compile(r"^[a-z]{2}-[A-Z]{2}$")
_METADATA_MAX_BYTES = 4096


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
    if get_settings().ENVIRONMENT == "local":
        return
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"{field} must use http or https")
    host = parsed.hostname or ""
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(host))
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError(f"{field} resolves to a private/internal address: {ip}")
    except socket.gaierror:
        pass  # DNS failure is allowed — will fail at delivery time


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


@router.post("/jobs", status_code=201, response_model=JobResponse)
@limiter.limit("100/hour")
async def submit_job(
    request: Request,
    body: SubmitJobRequest,
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
