"""BatchPollingService: polls Azure Batch Transcription and dispatches webhooks.

On each interval the service:
1. Queries for TranscriptionJobs in NOT_STARTED or RUNNING batch state using
   SELECT FOR UPDATE SKIP LOCKED (safe for multi-replica deployments).
2. Polls Azure for the current job status.
3. On Succeeded: downloads results, runs speaker processing, saves results,
   dispatches webhook to callback_url (if registered).
4. On Failed: records the error, dispatches failure webhook.
5. Deletes the Azure batch job after completion.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import sentry_sdk
from sqlmodel import Session

from transcription_svc.audio.azure_utils import AsyncAzureBlobManager
from transcription_svc.audio.batch_client import (
    BatchResultError,
    delete_batch_job,
    get_batch_job_status,
    get_batch_results,
)
from transcription_svc.audio.speakers import process_speakers
from transcription_svc.config.settings import get_settings
from transcription_svc.database.engine import get_engine
from transcription_svc.database.interface import (
    claim_webhook_dispatch,
    fetch_pending_batch_jobs,
    mark_job_error,
    mark_needs_cleanup,
    save_job_results,
    update_job_batch_status,
)
from transcription_svc.database.models import BatchJobStatus
from transcription_svc.webhook.dispatcher import dispatch

logger = logging.getLogger(__name__)

_POLL_BATCH_SIZE = 10


@dataclass(frozen=True)
class _PendingJob:
    id: UUID
    batch_job_url: str
    batch_job_status: BatchJobStatus
    callback_url: str | None
    caller_id: UUID
    metadata_: dict
    webhook_secret: str
    audio_blob_path: str | None = None


class BatchPollingService:
    """Background service that polls Azure Batch Transcription job status."""

    def __init__(self, webhook_secret_resolver=None) -> None:
        self.settings = get_settings()
        self._shutdown = False
        self._resolve_webhook_secret = webhook_secret_resolver or self._default_secret_resolver

    def _default_secret_resolver(self, caller_id: UUID) -> str:
        from transcription_svc.auth.validators import decrypt_webhook_secret
        from transcription_svc.database.interface import get_caller_by_id

        with Session(get_engine()) as session:
            caller = get_caller_by_id(session, caller_id)
            if not caller:
                raise ValueError(f"Caller {caller_id} not found; cannot resolve webhook secret")
            return decrypt_webhook_secret(caller.webhook_secret)  # raises InvalidToken on bad key

    async def run_polling_loop(self) -> None:
        logger.info(
            "BatchPollingService started (interval=%ds)",
            self.settings.BATCH_POLL_INTERVAL_SECONDS,
        )
        try:
            while not self._shutdown:
                try:
                    await self._poll_once()
                except Exception as exc:
                    logger.error("Unexpected error in polling loop: %s", exc)
                    sentry_sdk.capture_exception(exc)
                await asyncio.sleep(self.settings.BATCH_POLL_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("BatchPollingService cancelled")
            raise

    async def _poll_once(self) -> None:
        jobs = await asyncio.to_thread(self._fetch_pending_jobs)
        if not jobs:
            return
        logger.info("Checking %d pending batch job(s)", len(jobs))
        await asyncio.gather(
            *[self._process_job(job) for job in jobs],
            return_exceptions=True,
        )

    def _fetch_pending_jobs(self) -> list[_PendingJob]:
        with Session(get_engine()) as session:
            rows = fetch_pending_batch_jobs(session)
            result = []
            for row in rows:
                if not row.batch_job_url:
                    continue
                try:
                    webhook_secret = self._resolve_webhook_secret(row.caller_id)
                except Exception as exc:
                    logger.error(
                        "Cannot resolve webhook secret for caller %s (job %s skipped): %s",
                        row.caller_id,
                        row.id,
                        exc,
                    )
                    sentry_sdk.capture_exception(exc)
                    continue
                result.append(
                    _PendingJob(
                        id=row.id,
                        batch_job_url=row.batch_job_url,
                        batch_job_status=row.batch_job_status,
                        callback_url=row.callback_url,
                        caller_id=row.caller_id,
                        metadata_=row.metadata_,
                        webhook_secret=webhook_secret,
                        audio_blob_path=row.audio_blob_path,
                    )
                )
            return result

    async def _process_job(self, job: _PendingJob) -> None:
        try:
            status_data = await get_batch_job_status(job.batch_job_url)
            azure_status = status_data.get("status", "")

            if azure_status == BatchJobStatus.RUNNING:
                if job.batch_job_status == BatchJobStatus.NOT_STARTED:
                    await asyncio.to_thread(self._update_status, job.id, BatchJobStatus.RUNNING)
            elif azure_status == BatchJobStatus.SUCCEEDED:
                await self._handle_succeeded(job)
            elif azure_status == BatchJobStatus.FAILED:
                await self._handle_failed(job, status_data)

        except Exception as exc:
            logger.error("Error polling batch job %s: %s", job.id, exc)
            sentry_sdk.capture_exception(exc)

    def _update_status(self, job_id: UUID, status: BatchJobStatus) -> None:
        with Session(get_engine()) as session:
            update_job_batch_status(session, job_id, status)

    async def _handle_succeeded(self, job: _PendingJob) -> None:
        try:
            dialogue_entries = await get_batch_results(
                job.batch_job_url, transcription_job_id=job.id
            )
        except BatchResultError as exc:
            logger.error("Failed to retrieve batch results for job %s: %s", job.id, exc)
            await asyncio.to_thread(self._record_error, job.id, str(exc))
            await self._dispatch_failure(job, str(exc))
            return
        except Exception as exc:
            logger.error("Failed to retrieve batch results for job %s: %s", job.id, exc)
            await asyncio.to_thread(self._record_error, job.id, str(exc))
            await self._dispatch_failure(job, str(exc))
            return

        processed_entries = process_speakers(dialogue_entries)

        await asyncio.to_thread(
            self._save_results, job.id, processed_entries, BatchJobStatus.SUCCEEDED
        )

        await self._dispatch_success(job, processed_entries)

        try:
            await delete_batch_job(job.batch_job_url)
        except Exception as exc:
            logger.warning("Could not delete batch job %s: %s", job.batch_job_url, exc)
            await asyncio.to_thread(self._record_cleanup_failure, job.id, str(exc))

    async def _handle_failed(self, job: _PendingJob, status_data: dict) -> None:
        error_msg = (
            status_data.get("properties", {})
            .get("error", {})
            .get("message", "Azure Batch Transcription failed")
        )
        logger.error("Batch job %s failed: %s", job.id, error_msg)
        await asyncio.to_thread(self._record_error, job.id, error_msg)

        if job.audio_blob_path:
            try:
                async with AsyncAzureBlobManager() as blob_manager:
                    await blob_manager.set_blob_metadata(
                        blob_name=job.audio_blob_path,
                        metadata={
                            "processed": "false",
                            "status": "permanently_failed",
                            "last_error": error_msg[:1000],
                            "failed_at": datetime.now(UTC).isoformat(),
                        },
                    )
            except Exception as exc:
                logger.warning("Could not mark blob %s as failed: %s", job.audio_blob_path, exc)

        await self._dispatch_failure(job, error_msg)

        try:
            await delete_batch_job(job.batch_job_url)
        except Exception as exc:
            logger.warning("Could not delete batch job %s: %s", job.batch_job_url, exc)
            await asyncio.to_thread(self._record_cleanup_failure, job.id, str(exc))

    def _save_results(self, job_id, entries, batch_status) -> None:
        with Session(get_engine()) as session:
            save_job_results(session, job_id, entries, batch_status)

    def _record_error(self, job_id, error_msg) -> None:
        with Session(get_engine()) as session:
            mark_job_error(session, job_id, error_msg)

    def _record_cleanup_failure(self, job_id, reason) -> None:
        with Session(get_engine()) as session:
            mark_needs_cleanup(session, job_id, reason)

    def _claim_webhook_dispatch(self, job_id: UUID) -> bool:
        with Session(get_engine()) as session:
            return claim_webhook_dispatch(session, job_id)

    async def _dispatch_success(self, job: _PendingJob, entries) -> None:
        if not job.callback_url:
            return
        if not await asyncio.to_thread(self._claim_webhook_dispatch, job.id):
            logger.info(
                "Webhook already dispatched for job %s by another replica; skipping", job.id
            )
            return
        payload = {
            "job_id": str(job.id),
            "status": "succeeded",
            "dialogue_entries": [
                e.model_dump() if hasattr(e, "model_dump") else e for e in entries
            ],
            "error_message": None,
            "metadata": job.metadata_,
        }
        delivered = await dispatch(job.callback_url, job.webhook_secret, payload)
        if not delivered:
            logger.error(
                "Webhook delivery permanently failed for job %s after all retries; "
                "caller will not receive the success result",
                job.id,
            )

    async def _dispatch_failure(self, job: _PendingJob, error_msg: str) -> None:
        if not job.callback_url:
            return
        if not await asyncio.to_thread(self._claim_webhook_dispatch, job.id):
            logger.info(
                "Webhook already dispatched for job %s by another replica; skipping", job.id
            )
            return
        payload = {
            "job_id": str(job.id),
            "status": "failed",
            "dialogue_entries": [],
            "error_message": error_msg,
            "metadata": job.metadata_,
        }
        delivered = await dispatch(job.callback_url, job.webhook_secret, payload)
        if not delivered:
            logger.error(
                "Webhook delivery permanently failed for job %s after all retries; "
                "caller will not receive the failure notification",
                job.id,
            )
