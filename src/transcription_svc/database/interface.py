from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import update as sa_update
from sqlmodel import Session, col, select

from transcription_svc.config.settings import get_settings
from transcription_svc.database.models import (
    BatchJobStatus,
    Caller,
    CorrectionDatasetEntry,
    DialogueEntry,
    JobStatus,
    TranscriptionJob,
)

_POLL_BATCH_SIZE = 10


def save_job(session: Session, job: TranscriptionJob) -> TranscriptionJob:
    job.updated_datetime = datetime.now(UTC)
    merged = session.merge(job)
    session.commit()
    session.refresh(merged)
    return merged


def get_job_by_id(session: Session, job_id: UUID) -> TranscriptionJob | None:
    return session.get(TranscriptionJob, job_id)


def list_jobs_by_caller(
    session: Session, caller_id: UUID, limit: int = 50
) -> list[TranscriptionJob]:
    stmt = (
        select(TranscriptionJob)
        .where(TranscriptionJob.caller_id == caller_id)
        .order_by(col(TranscriptionJob.created_datetime).desc())
        .limit(limit)
    )
    return list(session.exec(stmt).all())


def get_job_by_idempotency_key(
    session: Session, key: str, caller_id: UUID
) -> TranscriptionJob | None:
    stmt = select(TranscriptionJob).where(
        TranscriptionJob.idempotency_key == key,
        TranscriptionJob.caller_id == caller_id,
    )
    return session.exec(stmt).first()


def fetch_pending_batch_jobs(session: Session) -> list[TranscriptionJob]:
    stmt = (
        select(TranscriptionJob)
        .where(
            col(TranscriptionJob.batch_job_status).in_(
                [BatchJobStatus.NOT_STARTED, BatchJobStatus.RUNNING]
            ),
            TranscriptionJob.status != JobStatus.FAILED,
        )
        .with_for_update(skip_locked=True)
        .limit(_POLL_BATCH_SIZE)
    )
    return list(session.exec(stmt).all())


def update_job_batch_status(session: Session, job_id: UUID, batch_status: BatchJobStatus) -> None:
    job = session.get(TranscriptionJob, job_id)
    if job:
        job.batch_job_status = batch_status
        if batch_status == BatchJobStatus.RUNNING:
            job.status = JobStatus.RUNNING
        job.updated_datetime = datetime.now(UTC)
        session.add(job)
        session.commit()


def save_job_results(
    session: Session,
    job_id: UUID,
    entries: list[DialogueEntry],
    batch_status: BatchJobStatus,
    transcription_duration_seconds: float | None = None,
    model_identifier: str | None = None,
) -> None:
    job = session.get(TranscriptionJob, job_id)
    if job:
        job.dialogue_entries = [e.model_dump() if hasattr(e, "model_dump") else e for e in entries]
        job.batch_job_status = batch_status
        job.status = (
            JobStatus.SUCCEEDED if batch_status == BatchJobStatus.SUCCEEDED else JobStatus.FAILED
        )
        job.transcription_duration_seconds = transcription_duration_seconds
        job.model_identifier = model_identifier
        job.updated_datetime = datetime.now(UTC)
        session.add(job)
        session.commit()


def mark_job_error(
    session: Session,
    job_id: UUID,
    error_message: str,
    batch_status: BatchJobStatus = BatchJobStatus.FAILED,
) -> None:
    job = session.get(TranscriptionJob, job_id)
    if job:
        job.batch_job_status = batch_status
        job.status = JobStatus.FAILED
        job.error_message = error_message
        job.updated_datetime = datetime.now(UTC)
        session.add(job)
        session.commit()


def mark_needs_cleanup(session: Session, job_id: UUID, reason: str) -> None:
    job = session.get(TranscriptionJob, job_id)
    if job:
        job.needs_cleanup = True
        job.cleanup_failure_reason = reason[:500]
        job.updated_datetime = datetime.now(UTC)
        session.add(job)
        session.commit()


def claim_webhook_dispatch(session: Session, job_id: UUID) -> bool:
    """Atomically mark a job's webhook as dispatched. Returns True only for the first caller.

    Uses a conditional UPDATE (WHERE webhook_dispatched_at IS NULL) so only one
    replica wins the race even if multiple pick up the same job simultaneously.
    """
    stmt = (
        sa_update(TranscriptionJob)
        .where(
            TranscriptionJob.id == job_id,
            TranscriptionJob.webhook_dispatched_at.is_(None),
        )
        .values(webhook_dispatched_at=datetime.now(UTC))
        .returning(TranscriptionJob.id)
    )
    result = session.execute(stmt)
    session.commit()
    return result.first() is not None


def record_correction_dataset_entry(
    session: Session,
    *,
    job: TranscriptionJob,
    segment_index: int,
    correction_kind: str,
    original_text: str,
    corrected_text: str,
    confidence: float | None,
    speaker: str,
    start_word_index: int | None = None,
    end_word_index: int | None = None,
) -> None:
    """Stage a row for the corrections training dataset (DIAAT-231).

    A no-op unless `Settings.CORRECTIONS_DATASET_EXPORT_ENABLED` is True —
    see CorrectionDatasetEntry's docstring for why this is off by default
    (retention/anonymisation sign-off for real hearing content is pending).

    Only stages the row via `session.add` — it's the caller's responsibility
    to commit (typically alongside the job update it accompanies), so the
    correction and its dataset copy are persisted atomically.
    """
    if not get_settings().CORRECTIONS_DATASET_EXPORT_ENABLED:
        return

    session.add(
        CorrectionDatasetEntry(
            job_id=job.id,
            caller_id=job.caller_id,
            segment_index=segment_index,
            correction_kind=correction_kind,
            start_word_index=start_word_index,
            end_word_index=end_word_index,
            speaker=speaker,
            locale=job.locale,
            original_text=original_text,
            corrected_text=corrected_text,
            confidence=confidence,
        )
    )


def get_caller_by_id(session: Session, caller_id: UUID) -> Caller | None:
    return session.get(Caller, caller_id)


def get_caller_by_lookup_hash(session: Session, lookup_hash: str) -> Caller | None:
    stmt = select(Caller).where(
        Caller.key_lookup_hash == lookup_hash,
        Caller.is_active == True,  # noqa: E712
    )
    return session.exec(stmt).first()


def get_all_active_callers(session: Session) -> list[Caller]:
    stmt = select(Caller).where(Caller.is_active == True)  # noqa: E712
    return list(session.exec(stmt).all())
