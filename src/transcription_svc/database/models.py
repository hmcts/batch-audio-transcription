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


class WordInfo(SQLModel):
    text: str
    start_time: float
    end_time: float
    confidence: float


class WordCorrection(SQLModel):
    """An active replacement for a contiguous run of the *original* words.

    Indices always refer to positions in DialogueEntry.words (never
    renumbered), so multiple non-overlapping corrections can coexist and
    still be rendered against the original per-word confidence/timing for
    everything outside the corrected ranges.
    """

    start_word_index: int
    end_word_index: int  # inclusive
    text: str


class CorrectionEntry(SQLModel):
    """One logged change to a segment's text — append-only audit trail.

    A "rollback" is just another entry (kind="rollback") rather than a
    destructive edit, so the full history always stays intact and visible.
    A clerk confirming a segment is correct as-is (without editing it) also
    logs an entry here (kind="accept_all") rather than inventing a separate
    mechanism — previous_text/new_text are identical for that kind, since no
    text actually changed; only DialogueEntry.accepted flips to True.
    """

    timestamp: str  # ISO 8601, set by the backend
    kind: str  # "segment" | "word_range" | "rollback" | "accept_all"
    previous_text: str  # effective *segment* text immediately before this change
    new_text: str  # effective *segment* text immediately after this change
    start_word_index: int | None = None  # set only for kind="word_range"
    end_word_index: int | None = None  # inclusive; set only for kind="word_range"
    # Just the phrase that actually changed — set only for kind="word_range",
    # so a UI can show "quick" -> "slow" instead of the whole (possibly very
    # long) segment text. previous_text/new_text stay whole-segment since
    # rollback_to_history_entry restores from them.
    previous_phrase: str | None = None
    new_phrase: str | None = None


class DialogueEntry(SQLModel):
    speaker: str
    text: str
    start_time: float
    end_time: float
    # Azure's own per-phrase confidence (0-1), not a verified accuracy
    # measurement — there's no human reference transcript to compare
    # against until a clerk corrects a segment (see corrected_text).
    confidence: float | None = None
    # Whole-segment freeform override — set by editing the segment's text
    # directly rather than a specific low-confidence phrase. Takes full
    # precedence over word_corrections when set. `text` is never mutated,
    # so the original auto-generated wording stays available to compute a
    # real word error rate against it.
    corrected_text: str | None = None
    # Active, non-overlapping replacements for specific runs of the
    # original words — lets the frontend keep showing per-word confidence
    # and playback-sync highlighting for everything the clerk hasn't
    # touched, instead of falling back to plain text for the whole segment.
    word_corrections: list[WordCorrection] | None = None
    correction_history: list[CorrectionEntry] | None = None
    # Per-word timing/confidence for the original (never corrected) text —
    # lets the frontend highlight individual low-confidence words and sync
    # highlighting to live playback position. None if Azure didn't return
    # word-level detail for this phrase.
    words: list[WordInfo] | None = None
    # Set by the "accept all" action — a clerk confirming a low-confidence
    # segment is correct as transcribed, without editing its text. Deliberately
    # independent of has_corrections()/corrected_text: accepting must not make
    # this segment count towards the word-error-rate calculation in
    # audio/accuracy.py (nothing was actually corrected), but it must still
    # remove the segment from "needs review" (see compute_accuracy()).
    accepted: bool = False

    def has_corrections(self) -> bool:
        return self.corrected_text is not None or bool(self.word_corrections)

    def effective_text(self) -> str:
        """Current text after any corrections — what a clerk would read today."""
        if self.corrected_text is not None:
            return self.corrected_text
        if self.word_corrections and self.words:
            parts: list[str] = []
            cursor = 0
            for wc in sorted(self.word_corrections, key=lambda w: w.start_word_index):
                parts.append(" ".join(w.text for w in self.words[cursor : wc.start_word_index]))
                parts.append(wc.text)
                cursor = wc.end_word_index + 1
            parts.append(" ".join(w.text for w in self.words[cursor:]))
            return " ".join(p for p in parts if p)
        return self.text


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
