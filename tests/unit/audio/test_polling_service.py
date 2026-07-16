"""Unit tests for BatchPollingService."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest

_JOB_ID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
_CALLER_ID = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
_JOB_URL = "https://eastus.cognitiveservices.azure.com/speechtotext/transcriptions/abc"
_WEBHOOK_SECRET = "test-secret"


def _make_pending_job(batch_status="NotStarted", callback_url="https://cb.example.com/hook"):
    from transcription_svc.audio.polling_service import _PendingJob
    from transcription_svc.database.models import BatchJobStatus

    return _PendingJob(
        id=_JOB_ID,
        batch_job_url=_JOB_URL,
        batch_job_status=BatchJobStatus(batch_status),
        callback_url=callback_url,
        caller_id=_CALLER_ID,
        metadata_={"ref": "test"},
        webhook_secret=_WEBHOOK_SECRET,
    )


@pytest.fixture
def service():
    from transcription_svc.audio.polling_service import BatchPollingService

    svc = BatchPollingService(webhook_secret_resolver=lambda caller_id: _WEBHOOK_SECRET)
    return svc


class TestExtractModelIdentifier:
    def test_uses_azure_model_self_url_when_present(self):
        from transcription_svc.audio.polling_service import _extract_model_identifier

        status_data = {"model": {"self": "https://eastus.example.com/models/base/xyz"}}
        assert (
            _extract_model_identifier(status_data, "en-GB")
            == "https://eastus.example.com/models/base/xyz"
        )

    def test_falls_back_to_locale_label_when_model_missing(self):
        from transcription_svc.audio.polling_service import _extract_model_identifier

        assert _extract_model_identifier({}, "en-GB") == "azure-speech-batch-transcription (en-GB)"

    def test_falls_back_when_model_self_is_blank(self):
        from transcription_svc.audio.polling_service import _extract_model_identifier

        status_data = {"model": {"self": ""}}
        assert (
            _extract_model_identifier(status_data, "fr-FR")
            == "azure-speech-batch-transcription (fr-FR)"
        )


class TestExtractTranscriptionDurationSeconds:
    def test_uses_azure_timestamps_when_both_present(self):
        from transcription_svc.audio.polling_service import (
            _extract_transcription_duration_seconds,
        )

        status_data = {
            "createdDateTime": "2026-07-15T10:00:00Z",
            "lastActionDateTime": "2026-07-15T10:01:30Z",
        }
        assert _extract_transcription_duration_seconds(status_data, None) == 90.0

    def test_falls_back_to_wall_clock_when_azure_timestamps_missing(self):
        from transcription_svc.audio.polling_service import (
            _extract_transcription_duration_seconds,
        )

        started = datetime.now(UTC) - timedelta(seconds=30)
        duration = _extract_transcription_duration_seconds({}, started)
        assert duration is not None
        assert 29.0 <= duration <= 35.0

    def test_falls_back_when_azure_timestamps_unparseable(self):
        from transcription_svc.audio.polling_service import (
            _extract_transcription_duration_seconds,
        )

        started = datetime.now(UTC) - timedelta(seconds=10)
        status_data = {"createdDateTime": "not-a-date", "lastActionDateTime": "also-not-a-date"}
        duration = _extract_transcription_duration_seconds(status_data, started)
        assert duration is not None
        assert 9.0 <= duration <= 15.0

    def test_returns_none_when_nothing_available(self):
        from transcription_svc.audio.polling_service import (
            _extract_transcription_duration_seconds,
        )

        assert _extract_transcription_duration_seconds({}, None) is None


class TestProcessJob:
    @pytest.mark.asyncio
    async def test_updates_status_to_running_when_azure_reports_running(self, service):
        job = _make_pending_job(batch_status="NotStarted")
        status_data = {"status": "Running"}

        with (
            patch(
                "transcription_svc.audio.polling_service.get_batch_job_status",
                new_callable=AsyncMock,
                return_value=status_data,
            ),
            patch.object(service, "_update_status") as mock_update,
        ):
            await service._process_job(job)

        from transcription_svc.database.models import BatchJobStatus

        mock_update.assert_called_once_with(_JOB_ID, BatchJobStatus.RUNNING)

    @pytest.mark.asyncio
    async def test_dispatches_to_handle_succeeded(self, service):
        job = _make_pending_job(batch_status="Running")
        status_data = {"status": "Succeeded"}

        with (
            patch(
                "transcription_svc.audio.polling_service.get_batch_job_status",
                new_callable=AsyncMock,
                return_value=status_data,
            ),
            patch.object(service, "_handle_succeeded", new_callable=AsyncMock) as mock_succeeded,
        ):
            await service._process_job(job)

        mock_succeeded.assert_awaited_once_with(job, status_data)

    @pytest.mark.asyncio
    async def test_dispatches_to_handle_failed(self, service):
        job = _make_pending_job()
        status_data = {"status": "Failed", "properties": {"error": {"message": "speech error"}}}

        with (
            patch(
                "transcription_svc.audio.polling_service.get_batch_job_status",
                new_callable=AsyncMock,
                return_value=status_data,
            ),
            patch.object(service, "_handle_failed", new_callable=AsyncMock) as mock_failed,
        ):
            await service._process_job(job)

        mock_failed.assert_awaited_once_with(job, status_data)


class TestHandleSucceeded:
    @pytest.mark.asyncio
    async def test_dispatches_webhook_on_success(self, service):
        job = _make_pending_job()
        mock_entries = [MagicMock()]

        with (
            patch(
                "transcription_svc.audio.polling_service.get_batch_results",
                new_callable=AsyncMock,
                return_value=mock_entries,
            ),
            patch(
                "transcription_svc.audio.polling_service.process_speakers",
                return_value=mock_entries,
            ),
            patch.object(service, "_save_results"),
            patch.object(service, "_dispatch_success", new_callable=AsyncMock) as mock_dispatch,
            patch(
                "transcription_svc.audio.polling_service.delete_batch_job",
                new_callable=AsyncMock,
            ),
        ):
            await service._handle_succeeded(job, {"status": "Succeeded"})

        mock_dispatch.assert_awaited_once_with(job, mock_entries)

    @pytest.mark.asyncio
    async def test_saves_model_identifier_and_duration_from_azure_response(self, service):
        job = _make_pending_job()
        mock_entries = [MagicMock()]
        status_data = {
            "status": "Succeeded",
            "model": {"self": "https://eastus.api.cognitive.microsoft.com/models/base/abc123"},
            "createdDateTime": "2026-07-15T09:00:00Z",
            "lastActionDateTime": "2026-07-15T09:00:42Z",
        }

        with (
            patch(
                "transcription_svc.audio.polling_service.get_batch_results",
                new_callable=AsyncMock,
                return_value=mock_entries,
            ),
            patch(
                "transcription_svc.audio.polling_service.process_speakers",
                return_value=mock_entries,
            ),
            patch.object(service, "_save_results") as mock_save,
            patch.object(service, "_dispatch_success", new_callable=AsyncMock),
            patch(
                "transcription_svc.audio.polling_service.delete_batch_job",
                new_callable=AsyncMock,
            ),
        ):
            await service._handle_succeeded(job, status_data)

        from transcription_svc.database.models import BatchJobStatus

        mock_save.assert_called_once_with(
            job.id,
            mock_entries,
            BatchJobStatus.SUCCEEDED,
            42.0,
            "https://eastus.api.cognitive.microsoft.com/models/base/abc123",
        )

    @pytest.mark.asyncio
    async def test_falls_back_to_locale_label_when_azure_omits_model(self, service):
        job = _make_pending_job()
        mock_entries = [MagicMock()]

        with (
            patch(
                "transcription_svc.audio.polling_service.get_batch_results",
                new_callable=AsyncMock,
                return_value=mock_entries,
            ),
            patch(
                "transcription_svc.audio.polling_service.process_speakers",
                return_value=mock_entries,
            ),
            patch.object(service, "_save_results") as mock_save,
            patch.object(service, "_dispatch_success", new_callable=AsyncMock),
            patch(
                "transcription_svc.audio.polling_service.delete_batch_job",
                new_callable=AsyncMock,
            ),
        ):
            await service._handle_succeeded(job, {"status": "Succeeded"})

        model_identifier = mock_save.call_args[0][4]
        assert model_identifier == "azure-speech-batch-transcription (en-GB)"

    @pytest.mark.asyncio
    async def test_marks_needs_cleanup_when_delete_fails(self, service):
        job = _make_pending_job()
        mock_entries = [MagicMock()]

        with (
            patch(
                "transcription_svc.audio.polling_service.get_batch_results",
                new_callable=AsyncMock,
                return_value=mock_entries,
            ),
            patch(
                "transcription_svc.audio.polling_service.process_speakers",
                return_value=mock_entries,
            ),
            patch.object(service, "_save_results"),
            patch.object(service, "_dispatch_success", new_callable=AsyncMock),
            patch(
                "transcription_svc.audio.polling_service.delete_batch_job",
                new_callable=AsyncMock,
                side_effect=Exception("Azure error"),
            ),
            patch.object(service, "_record_cleanup_failure") as mock_cleanup,
        ):
            await service._handle_succeeded(job, {"status": "Succeeded"})

        mock_cleanup.assert_called_once()

    @pytest.mark.asyncio
    async def test_dispatches_failure_webhook_when_results_unavailable(self, service):
        job = _make_pending_job()

        with (
            patch(
                "transcription_svc.audio.polling_service.get_batch_results",
                new_callable=AsyncMock,
                side_effect=Exception("BatchResultError"),
            ),
            patch.object(service, "_record_error"),
            patch.object(service, "_dispatch_failure", new_callable=AsyncMock) as mock_fail,
        ):
            await service._handle_succeeded(job, {"status": "Succeeded"})

        mock_fail.assert_awaited_once()


class TestHandleFailed:
    @pytest.mark.asyncio
    async def test_records_error_and_dispatches_webhook(self, service):
        job = _make_pending_job()
        status_data = {"properties": {"error": {"message": "Azure transcription failed"}}}

        with (
            patch.object(service, "_record_error") as mock_error,
            patch.object(service, "_dispatch_failure", new_callable=AsyncMock) as mock_dispatch,
        ):
            await service._handle_failed(job, status_data)

        mock_error.assert_called_once_with(_JOB_ID, "Azure transcription failed")
        mock_dispatch.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_uses_default_message_when_absent(self, service):
        job = _make_pending_job()
        status_data = {}

        with (
            patch.object(service, "_record_error") as mock_error,
            patch.object(service, "_dispatch_failure", new_callable=AsyncMock),
        ):
            await service._handle_failed(job, status_data)

        args = mock_error.call_args[0]
        assert "failed" in args[1].lower()

    @pytest.mark.asyncio
    async def test_skips_webhook_when_no_callback_url(self, service):
        from transcription_svc.audio.polling_service import _PendingJob
        from transcription_svc.database.models import BatchJobStatus

        job = _PendingJob(
            id=_JOB_ID,
            batch_job_url=_JOB_URL,
            batch_job_status=BatchJobStatus.RUNNING,
            callback_url=None,
            caller_id=_CALLER_ID,
            metadata_={},
            webhook_secret=_WEBHOOK_SECRET,
        )

        with (
            patch.object(service, "_record_error"),
            patch(
                "transcription_svc.audio.polling_service.dispatch",
                new_callable=AsyncMock,
            ) as mock_dispatch,
        ):
            await service._handle_failed(job, {})

        mock_dispatch.assert_not_awaited()
