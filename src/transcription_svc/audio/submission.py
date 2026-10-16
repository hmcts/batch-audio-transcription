"""Batch transcription submission pipeline."""

from __future__ import annotations

import logging
from uuid import UUID

from hmcts_otel import capture_trace_context, journey, record_event, stage
from hmcts_otel import conventions as c
from sqlmodel import Session

from transcription_svc.audio.batch_client import BatchSubmissionError, submit_batch_job
from transcription_svc.database.interface import save_job
from transcription_svc.database.models import BatchJobStatus, JobStatus, TranscriptionJob
from transcription_svc.telemetry import JOURNEY_JOB, upload_id_from_blob

logger = logging.getLogger(__name__)


async def submit_and_queue_batch_job(
    session: Session,
    audio_url: str,
    caller_id: UUID | None = None,
    locale: str = "en-GB",
    enable_diarization: bool = True,
    callback_url: str | None = None,
    idempotency_key: str | None = None,
    metadata: dict | None = None,
    audio_duration_seconds: float | None = None,
    audio_blob_path: str | None = None,
    user_id: UUID | None = None,
) -> TranscriptionJob:
    """Submit audio to Azure Batch Transcription and persist the initial job record.

    Creates a TranscriptionJob with status PENDING, submits to Azure,
    then updates the record to SUBMITTED. On failure, saves error state.
    """
    job = TranscriptionJob(
        caller_id=caller_id,
        user_id=user_id,
        audio_url=audio_url,
        locale=locale,
        enable_diarization=enable_diarization,
        callback_url=callback_url,
        idempotency_key=idempotency_key,
        metadata_=metadata or {},
        audio_duration_seconds=audio_duration_seconds,
        audio_blob_path=audio_blob_path,
        status=JobStatus.PENDING,
        # DIAAT-276: the poller links the job's later processing to this request.
        trace_parent=capture_trace_context(),
    )
    job = save_job(session, job)

    with journey(JOURNEY_JOB, str(job.id), parent_id=upload_id_from_blob(audio_blob_path)):
        record_event("job.created")
        return await _submit(session, job, audio_url, locale, enable_diarization)


async def _submit(
    session: Session, job: TranscriptionJob, audio_url: str, locale: str, enable_diarization: bool
) -> TranscriptionJob:
    with stage("speech_submission") as submission:
        try:
            return await _submit_to_speech(
                session, job, audio_url, locale, enable_diarization, submission
            )
        except BatchSubmissionError:
            submission.fail("speech.submission_rejected")
            record_event(
                "job.finished", {c.OUTCOME: "failure", c.ERROR_CODE: "speech.submission_rejected"}
            )
            raise
        except Exception:
            record_event("job.finished", {c.OUTCOME: "error", c.ERROR_CODE: "job.submission_error"})
            raise


async def _submit_to_speech(
    session: Session,
    job: TranscriptionJob,
    audio_url: str,
    locale: str,
    enable_diarization: bool,
    submission,
) -> TranscriptionJob:
    try:
        job_url = await submit_batch_job(
            audio_sas_url=audio_url,
            display_name=f"batch-{job.id}",
            locale=locale,
            enable_diarization=enable_diarization,
        )

        batch_job_id = job_url.rstrip("/").split("/")[-1]
        # Relates our job ID to the Azure Speech job ID in every later query.
        submission.set_dependency_ref(batch_job_id)

        job.batch_job_id = batch_job_id
        job.batch_job_url = job_url
        job.batch_job_status = BatchJobStatus.NOT_STARTED
        job.status = JobStatus.SUBMITTED
        job = save_job(session, job)

        logger.info("Batch job submitted: job_id=%s azure_job_id=%s", job.id, batch_job_id)

    except BatchSubmissionError as exc:
        # Type and stack only: the Azure error text can echo request content (DIAAT-274 P7).
        logger.error(
            "Batch submission failed for job %s (%s)", job.id, type(exc).__name__, exc_info=exc
        )
        import sentry_sdk

        sentry_sdk.capture_exception(exc)
        job.status = JobStatus.FAILED
        # Store only the high-level message — full Azure error detail (which
        # may contain endpoint URLs or subscription IDs) goes to Sentry only.
        job.error_message = "Azure batch transcription submission failed"
        job = save_job(session, job)
        raise
    except Exception as exc:
        logger.error(
            "Unexpected error submitting job %s (%s)", job.id, type(exc).__name__, exc_info=exc
        )
        import sentry_sdk

        sentry_sdk.capture_exception(exc)
        job.status = JobStatus.FAILED
        job.error_message = "Job submission failed due to an internal error"
        job = save_job(session, job)
        raise

    return job
