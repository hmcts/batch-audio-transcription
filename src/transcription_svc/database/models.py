from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import Column, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class JobStatus(StrEnum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class BatchJobStatus(StrEnum):
    NOT_STARTED = "NotStarted"
    RUNNING = "Running"
    SUCCEEDED = "Succeeded"
    FAILED = "Failed"


class BaseTable(SQLModel):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    created_datetime: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_datetime: datetime | None = Field(default=None)


class DialogueEntry(SQLModel):
    speaker: str
    text: str
    start_time: float
    end_time: float


class Caller(BaseTable, table=True):
    __tablename__ = "caller"

    name: str = Field(index=True)
    hashed_key: str
    # SHA-256 of the raw API key, used as a fast indexed lookup before bcrypt verify.
    # Populated on key creation; NULL for legacy rows (fallback to linear scan).
    key_lookup_hash: str | None = Field(default=None, index=True)
    webhook_secret: str
    is_active: bool = Field(default=True)
    azure_app_id: str | None = Field(default=None)


class TranscriptionJob(BaseTable, table=True):
    __tablename__ = "transcription_job"
    __table_args__ = (
        UniqueConstraint(
            "caller_id", "idempotency_key", name="uq_transcription_job_caller_idempotency"
        ),
    )

    caller_id: UUID = Field(foreign_key="caller.id", index=True)
    status: JobStatus = Field(default=JobStatus.PENDING)

    # Submission fields
    audio_url: str
    locale: str = Field(default="en-GB")
    enable_diarization: bool = Field(default=True)
    callback_url: str | None = Field(default=None)
    idempotency_key: str | None = Field(default=None)
    metadata_: dict = Field(default_factory=dict, sa_column=Column("metadata", JSONB))

    # Results
    dialogue_entries: list = Field(default_factory=list, sa_column=Column(JSONB))
    error_message: str | None = Field(default=None)

    # Azure batch tracking
    batch_job_id: str | None = Field(default=None)
    batch_job_status: BatchJobStatus | None = Field(default=None)
    batch_job_url: str | None = Field(default=None)
    audio_duration_seconds: float | None = Field(default=None)
    audio_blob_path: str | None = Field(default=None)

    # Cleanup
    needs_cleanup: bool = Field(default=False)
    cleanup_failure_reason: str | None = Field(default=None)

    # Webhook delivery guard — set atomically by the replica that wins the dispatch race.
    # NULL means no webhook has been dispatched yet for this job.
    webhook_dispatched_at: datetime | None = Field(default=None)
