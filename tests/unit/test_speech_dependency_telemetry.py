"""DIAAT-282: observe Azure Speech as an external dependency.

Acceptance criteria covered:
1. a failed job can be attributed to the application, the queue or the Azure Speech
   dependency (hmcts.failure.source on job.finished, job.poll_failed and job.stuck);
2. Azure Speech duration and failure trends are visible (call-duration histogram,
   failure and throttled counters, the finished-jobs counter by failure source);
3. the application's job ID relates to the Azure Speech job ID (hmcts.dependency.ref
   on every job event once Azure has accepted the job; displayName carries our job ID).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from hmcts_otel import conventions as c
from hmcts_otel import get_meter, journey
from hmcts_otel.testing import TelemetryCapture, capture_telemetry
from sqlalchemy.exc import OperationalError
from tenacity import Future, RetryError

from transcription_svc.audio import job_telemetry, speech_telemetry, submission
from transcription_svc.audio.batch_client import (
    BatchResultError,
    BatchSubmissionError,
    delete_batch_job,
    get_batch_job_status,
)
from transcription_svc.audio.job_telemetry import (
    METRIC_JOBS_FINISHED,
    METRIC_SPEECH_UTILISATION,
    JobStateGauges,
    failure_source,
)
from transcription_svc.audio.polling_service import BatchPollingService, _PendingJob
from transcription_svc.audio.speech_telemetry import (
    METRIC_SPEECH_CALL_DURATION,
    METRIC_SPEECH_CALL_FAILURES,
    METRIC_SPEECH_THROTTLED,
)
from transcription_svc.config.settings import get_settings
from transcription_svc.database.interface import JobStateCounts
from transcription_svc.database.models import BatchJobStatus
from transcription_svc.telemetry import JOURNEY_JOB, configure_telemetry

SPEECH_JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
MODEL_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
ENDPOINT = "https://test.cognitiveservices.azure.com"
SPEECH_URL = f"{ENDPOINT}/speechtotext/v3.2/transcriptions/{SPEECH_JOB_ID}"
UPLOAD_ID = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f"
FILE_STEM = "Smith" + "_v_" + "Home_Office"  # an original file name: never exported
SAS_SIGNATURE = "c2VjcmV0LXNpZ25hdHVyZQ"  # a SAS token's signature: never exported
AUDIO_SAS_URL = (
    f"https://acct.blob.core.windows.net/audio/uploads/u/{UPLOAD_ID}-{FILE_STEM}.wav"
    f"?sv=2024-05-04&se=2026-10-23&sp=r&sig={SAS_SIGNATURE}"
)
BLOB = f"uploads/00000000-0000-0000-0000-000000000001/{UPLOAD_ID}-{FILE_STEM}.wav"
# Azure's free-text error message: it can echo the request, so it is never exported.
AZURE_MESSAGE = f"Cannot access {AUDIO_SAS_URL} for hearing {FILE_STEM}"
BASE = "transcription_svc.audio.polling_service"


@pytest.fixture
def tel():
    with capture_telemetry() as capture:
        configure_telemetry()
        yield capture


@pytest.fixture
def no_backoff(monkeypatch):
    monkeypatch.setattr(asyncio, "sleep", AsyncMock())


def _response(status: int, method: str = "GET", url: str = SPEECH_URL, **kwargs):
    return httpx.Response(status, request=httpx.Request(method, url), **kwargs)


def _status_error(status: int, **kwargs) -> httpx.HTTPStatusError:
    response = _response(status, **kwargs)
    return httpx.HTTPStatusError("x", request=response.request, response=response)


def _exhausted(exc: BaseException) -> RetryError:
    attempt = Future(attempt_number=2)
    attempt.set_exception(exc)
    return RetryError(attempt)


def _points(tel: TelemetryCapture, metric: str) -> list[dict]:
    return tel.metric_points(metric)


def _pending(status: BatchJobStatus = BatchJobStatus.RUNNING, **fields) -> _PendingJob:
    created = datetime.now(UTC) - timedelta(minutes=30)
    defaults = {
        "audio_blob_path": BLOB,
        "locale": "en-GB",
        "enable_diarization": True,
        "created_datetime": created,
        "processing_started_datetime": created + timedelta(minutes=5),
    }
    return _PendingJob(
        id=uuid4(),
        batch_job_url=SPEECH_URL,
        batch_job_status=status,
        callback_url=None,
        caller_id=None,
        metadata_={},
        **{**defaults, **fields},
    )


def _service() -> BatchPollingService:
    service = BatchPollingService(webhook_secret_resolver=lambda _caller: "")
    service._save_results = MagicMock()
    service._record_error = MagicMock()
    service._update_status = MagicMock()
    service._record_cleanup_failure = MagicMock()
    service._dispatch_failure = AsyncMock()
    return service


async def _poll(service, job, status_data, results=None) -> None:
    with (
        patch(f"{BASE}.get_batch_job_status", new=AsyncMock(return_value=status_data)),
        patch(f"{BASE}.get_batch_results", new=results or AsyncMock(return_value=[])),
        patch(f"{BASE}.process_speakers", side_effect=lambda entries: entries),
        patch(f"{BASE}._resolve_model_display_name", new=AsyncMock(return_value=None)),
        patch(f"{BASE}.delete_batch_job", new=AsyncMock()),
    ):
        await service._process_job(job)


async def _submit(mocker, post=None, save=None):
    """Submit through the real Speech client with Azure's response replaced."""
    mocker.patch.object(submission, "save_job", side_effect=save or (lambda _s, job: job))
    if post is not None:
        mocker.patch.object(httpx.AsyncClient, "post", post)
    return await submission.submit_and_queue_batch_job(
        session=MagicMock(), audio_url=AUDIO_SAS_URL, audio_blob_path=BLOB, locale="en-GB"
    )


# AC1: failure attribution ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("code", "source"),
    [
        ("speech.submission_rejected", "dependency"),
        ("speech.job_failed", "dependency"),
        ("speech.results_unavailable", "dependency"),
        ("speech.http_500", "dependency"),
        ("speech.http_503", "dependency"),
        ("speech.http_401", "dependency"),
        ("speech.throttled", "dependency"),
        ("speech.timeout", "dependency"),
        ("speech.connect_error", "dependency"),
        ("speech.results_error", "application"),
        ("job.submission_error", "application"),
        ("unhandled.OperationalError", "application"),
        ("unhandled.KeyError", "application"),
        ("unknown", "application"),
        ("job.stuck.waiting", "queue"),
        ("job.stuck.running", "dependency"),
        ("webhook.http_502", "application"),  # not Azure Speech
    ],
)
def test_failure_source_by_code(code, source):
    assert failure_source(code) == source


@pytest.mark.parametrize(
    ("code", "exc", "source"),
    [
        ("job.submission_error", _exhausted(_status_error(503)), "dependency"),
        ("job.submission_error", _exhausted(httpx.ReadTimeout("x")), "dependency"),
        ("job.submission_error", httpx.ConnectError("x"), "dependency"),
        ("job.submission_error", OperationalError("insert", {}, Exception()), "application"),
        ("speech.results_error", _exhausted(_status_error(500)), "dependency"),
        ("speech.results_error", ValueError("bad json"), "application"),
        ("unhandled.RuntimeError", RuntimeError("bug"), "application"),
    ],
)
def test_generic_failure_codes_are_attributed_by_their_cause(code, exc, source):
    assert failure_source(code, exc) == source


async def test_azure_rejecting_the_job_is_a_dependency_failure_with_azure_details(tel, mocker):
    async def post(self, url, **_kwargs):
        body = {"code": "InvalidPayload", "message": AZURE_MESSAGE}
        return _response(400, "POST", url, json=body)

    with pytest.raises(BatchSubmissionError):
        await _submit(mocker, post)

    (finished,) = tel.events("job.finished")
    assert finished[c.ERROR_CODE] == "speech.submission_rejected"
    assert finished["hmcts.failure.source"] == "dependency"
    assert finished["http.response.status_code"] == 400
    assert finished["speech.error_code"] == "InvalidPayload"
    assert c.DEPENDENCY_REF not in finished  # Azure never accepted it
    (counted,) = _points(tel, METRIC_JOBS_FINISHED)
    assert counted["attributes"]["hmcts.failure.source"] == "dependency"
    # Never Azure's message, the SAS token or the file name.
    tel.assert_no_prohibited_content(AZURE_MESSAGE, SAS_SIGNATURE, FILE_STEM, "Cannot access")


async def test_database_failure_after_azure_accepted_is_the_applications(tel, mocker):
    async def post(self, url, **_kwargs):
        return _response(201, "POST", url, headers={"Location": SPEECH_URL})

    def save(_session, job):
        if job.batch_job_id:
            raise OperationalError("update", {}, Exception("db down"))
        return job

    with pytest.raises(OperationalError):
        await _submit(mocker, post, save)
    (finished,) = tel.events("job.finished")
    assert finished[c.ERROR_CODE] == "job.submission_error"
    assert finished["hmcts.failure.source"] == "application"
    assert finished[c.DEPENDENCY_REF] == SPEECH_JOB_ID  # Azure has the job: findable there


async def test_speech_timeouts_on_submission_are_the_dependencys(tel, mocker, no_backoff):
    async def post(self, url, **_kwargs):
        raise httpx.ReadTimeout("timed out")

    with pytest.raises(RetryError):
        await _submit(mocker, post)
    (finished,) = tel.events("job.finished")
    assert finished[c.ERROR_CODE] == "job.submission_error"
    assert finished["hmcts.failure.source"] == "dependency"


async def test_job_azure_reports_failed_carries_azures_code_never_its_message(tel):
    status = {
        "status": "Failed",
        "properties": {"error": {"code": "InvalidData", "message": AZURE_MESSAGE}},
    }
    await _poll(_service(), _pending(), status)
    (failed,) = tel.events("speech.job_failed")
    (finished,) = tel.events("job.finished")
    for event in (failed, finished):
        assert event["speech.error_code"] == "InvalidData"
        assert event["hmcts.failure.source"] == "dependency"
        assert event[c.DEPENDENCY_REF] == SPEECH_JOB_ID
    tel.assert_no_prohibited_content(AZURE_MESSAGE, SAS_SIGNATURE, FILE_STEM)


@pytest.mark.parametrize("code", ["has spaces", "1Numeric", "x" * 65, {"nested": 1}, None])
async def test_azure_error_codes_that_are_not_identifiers_are_dropped(tel, code):
    status = {"status": "Failed", "properties": {"error": {"code": code, "message": "m"}}}
    await _poll(_service(), _pending(), status)
    (finished,) = tel.events("job.finished")
    assert "speech.error_code" not in finished
    assert finished["hmcts.failure.source"] == "dependency"


def test_azure_error_code_is_read_only_when_it_is_an_identifier():
    read = job_telemetry.failed_job_error_code
    assert read({"properties": {"error": {"code": "AudioLengthLimitExceeded"}}}) == (
        "AudioLengthLimitExceeded"
    )
    for code in ("has spaces", "1Numeric", "x" * 65, "a/b", None, 7):
        assert read({"properties": {"error": {"code": code}}}) is None
    assert read({"properties": "x"}) is None and read({}) is None
    body = _response(400, json={"code": "contains spaces", "message": AZURE_MESSAGE})
    assert job_telemetry.response_error_code(body) is None
    assert job_telemetry.response_error_code(_response(400, text="not json")) is None


async def test_results_failures_are_attributed_by_their_cause(tel):
    ours = AsyncMock(side_effect=KeyError("recognizedPhrases"))
    await _poll(_service(), _pending(), {"status": "Succeeded"}, results=ours)
    azure = AsyncMock(side_effect=_exhausted(_status_error(500)))
    await _poll(_service(), _pending(), {"status": "Succeeded"}, results=azure)
    missing = AsyncMock(side_effect=BatchResultError("no transcription file"))
    await _poll(_service(), _pending(), {"status": "Succeeded"}, results=missing)

    finished = [
        (e[c.ERROR_CODE], e["hmcts.failure.source"], e.get("http.response.status_code"))
        for e in tel.events("job.finished")
    ]
    assert finished == [
        ("speech.results_error", "application", None),
        ("speech.results_error", "dependency", 500),
        ("speech.results_unavailable", "dependency", None),
    ]


async def test_poll_failures_are_attributed_and_correlated(tel):
    service = _service()
    service._update_status = MagicMock(side_effect=OperationalError("update", {}, Exception()))
    # Our database failed while recording that Azure started the job.
    await _poll(service, _pending(BatchJobStatus.NOT_STARTED), {"status": "Running"})
    # Azure Speech failed the status call.
    job = _pending()
    error = _exhausted(_status_error(502, json={"error": {"code": "BadGateway"}}))
    with patch(f"{BASE}.get_batch_job_status", new=AsyncMock(side_effect=error)):
        await _service()._process_job(job)

    ours, azure = tel.events("job.poll_failed")
    assert ours[c.ERROR_CODE] == "unhandled.OperationalError"
    assert ours["hmcts.failure.source"] == "application"
    assert azure[c.ERROR_CODE] == "speech.http_502"
    assert azure["hmcts.failure.source"] == "dependency"
    assert azure["http.response.status_code"] == 502
    assert azure["speech.error_code"] == "BadGateway"
    assert ours[c.DEPENDENCY_REF] == azure[c.DEPENDENCY_REF] == SPEECH_JOB_ID


def test_no_terminal_path_is_a_queue_failure_but_stuck_waiting_jobs_are(tel):
    session = MagicMock()
    now = datetime.now(UTC)
    waiting = MagicMock(status="submitted", created_datetime=now - timedelta(hours=1))
    waiting.batch_job_id, waiting.audio_blob_path, waiting.id = SPEECH_JOB_ID, BLOB, uuid4()
    running = MagicMock(status="running", processing_started_datetime=now - timedelta(hours=4))
    running.batch_job_id, running.audio_blob_path, running.id = SPEECH_JOB_ID, BLOB, uuid4()
    with patch.object(job_telemetry, "claim_stuck_jobs", return_value=[waiting, running]):
        job_telemetry.report_stuck_jobs(session)
    sources = {e["job.state"]: e["hmcts.failure.source"] for e in tel.events("job.stuck")}
    assert sources == {"waiting": "queue", "running": "dependency"}


# Throttling --------------------------------------------------------------------------------


async def test_throttled_status_calls_are_recorded_with_retry_after(tel, monkeypatch, no_backoff):
    calls = 0

    async def get(self, url, **_kwargs):
        nonlocal calls
        calls += 1
        body = {"error": {"code": "TooManyRequests", "message": AZURE_MESSAGE}}
        return _response(429, url=url, json=body, headers={"Retry-After": "17"})

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    job = _pending()
    with patch(f"{BASE}.get_batch_job_status", new=get_batch_job_status):
        await _service()._process_job(job)

    assert calls == 2  # the retry policy is unchanged: Retry-After is not honoured
    (retried,) = tel.events("job.retried")
    (failed,) = tel.events("job.poll_failed")
    for event in (retried, failed):
        assert event[c.ERROR_CODE] == "speech.throttled"
        assert event["speech.retry_after_s"] == 17.0
        assert event["http.response.status_code"] == 429
        assert event["speech.error_code"] == "TooManyRequests"
        assert event["hmcts.failure.source"] == "dependency"
        assert event[c.DEPENDENCY_REF] == SPEECH_JOB_ID
        assert event[c.JOURNEY_ID] == str(job.id)

    (throttled,) = _points(tel, METRIC_SPEECH_THROTTLED)
    assert throttled == {"attributes": {"speech.operation": "speech.status"}, "value": 2}
    (failures,) = _points(tel, METRIC_SPEECH_CALL_FAILURES)
    assert failures["attributes"][c.ERROR_CODE] == "speech.throttled"
    tel.assert_no_prohibited_content(AZURE_MESSAGE, FILE_STEM)


async def test_throttled_submission_is_recorded(tel, mocker):
    async def post(self, url, **_kwargs):
        return _response(429, "POST", url, headers={"Retry-After": "5"})

    with pytest.raises(BatchSubmissionError):
        await _submit(mocker, post)
    (finished,) = tel.events("job.finished")
    assert finished["http.response.status_code"] == 429
    assert finished["speech.retry_after_s"] == 5.0
    (throttled,) = _points(tel, METRIC_SPEECH_THROTTLED)
    assert throttled["attributes"] == {"speech.operation": "speech.submit"}


def test_429_is_throttled_not_an_http_code():
    assert job_telemetry.failure_code(_exhausted(_status_error(429)), "speech") == (
        "speech.throttled"
    )
    assert job_telemetry.failure_code(_status_error(503), "speech") == "speech.http_503"


def test_retry_after_is_read_as_seconds_date_or_milliseconds():
    seconds = job_telemetry.retry_after_seconds
    assert seconds(_response(429, headers={"Retry-After": "30"})) == 30.0
    later = format_datetime(datetime.now(UTC) + timedelta(seconds=120), usegmt=True)
    assert 100 <= seconds(_response(429, headers={"Retry-After": later})) <= 120
    past = format_datetime(datetime.now(UTC) - timedelta(seconds=120), usegmt=True)
    assert seconds(_response(429, headers={"Retry-After": past})) == 0.0
    assert seconds(_response(429, headers={"retry-after-ms": "1500"})) == 1.5
    assert seconds(_response(429, headers={"Retry-After": "soon"})) is None
    assert seconds(_response(429, headers={"Retry-After": "-1"})) is None
    assert seconds(_response(429)) is None


# AC2: Speech call metrics ------------------------------------------------------------------


def _calls(tel: TelemetryCapture) -> dict[tuple, int]:
    return {
        (
            p["attributes"]["speech.operation"],
            p["attributes"].get("http.response.status_code"),
            p["attributes"][c.OUTCOME],
            p["attributes"][c.ERROR_CODE],
        ): p["count"]
        for p in _points(tel, METRIC_SPEECH_CALL_DURATION)
    }


async def test_speech_calls_are_timed_by_operation_status_and_outcome(tel, monkeypatch, no_backoff):
    async def get(self, url, **_kwargs):
        if url.endswith("broken"):
            raise httpx.ConnectError("refused")
        return _response(200, url=url, json={"status": "Running"})

    async def delete(self, url, **_kwargs):
        return _response(404 if url.endswith("gone") else 503, "DELETE", url)

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    monkeypatch.setattr(httpx.AsyncClient, "delete", delete)

    assert await get_batch_job_status(SPEECH_URL) == {"status": "Running"}
    with pytest.raises(httpx.ConnectError):  # not retried
        await get_batch_job_status(SPEECH_URL + "broken")
    await delete_batch_job(SPEECH_URL + "gone")  # 404 on delete: already gone, success
    with pytest.raises(RetryError):
        await delete_batch_job(SPEECH_URL)

    assert _calls(tel) == {
        ("speech.status", 200, "success", "none"): 1,
        ("speech.status", None, "error", "speech.connect_error"): 1,
        ("speech.delete", 404, "success", "none"): 1,
        ("speech.delete", 503, "error", "speech.http_503"): 2,
    }
    failures = {
        (p["attributes"]["speech.operation"], p["attributes"][c.ERROR_CODE]): p["value"]
        for p in _points(tel, METRIC_SPEECH_CALL_FAILURES)
    }
    assert failures == {
        ("speech.status", "speech.connect_error"): 1,
        ("speech.delete", "speech.http_503"): 2,
    }
    assert not _points(tel, METRIC_SPEECH_THROTTLED)


async def test_results_and_model_calls_are_timed(tel, monkeypatch):
    from transcription_svc.audio.batch_client import get_batch_results, get_model_details

    content_url = f"https://spsvc.blob.core.windows.net/x/contenturl_0.json?sig={SAS_SIGNATURE}"

    async def get(self, url, **_kwargs):
        if url.endswith("/files"):
            files = {"values": [{"kind": "Transcription", "links": {"contentUrl": content_url}}]}
            return _response(200, url=url, json=files)
        return _response(200, url=url, json={"recognizedPhrases": []})

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    assert await get_batch_results(SPEECH_URL) == []
    await get_model_details(f"{ENDPOINT}/speechtotext/v3.2/models/base/{MODEL_ID}")
    assert _calls(tel) == {
        ("speech.results", 200, "success", "none"): 2,  # the file list and the transcript
        ("speech.model", 200, "success", "none"): 1,
    }
    tel.assert_no_prohibited_content(SAS_SIGNATURE)


async def test_telemetry_failure_never_fails_the_call(tel, monkeypatch):
    async def get(self, url, **_kwargs):
        return _response(200, url=url, json={"status": "Running"})

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    monkeypatch.setattr(speech_telemetry, "_record_call", MagicMock(side_effect=RuntimeError))
    assert await get_batch_job_status(SPEECH_URL) == {"status": "Running"}


async def test_call_failure_propagates_unchanged_when_telemetry_fails(tel, monkeypatch):
    async def get(self, url, **_kwargs):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    monkeypatch.setattr(speech_telemetry, "_record_call", MagicMock(side_effect=RuntimeError))
    with journey(JOURNEY_JOB, str(uuid4())), pytest.raises(httpx.ConnectError):
        await get_batch_job_status(SPEECH_URL)


async def test_cancellation_is_not_counted_as_a_speech_failure(tel, monkeypatch):
    async def get(self, url, **_kwargs):
        raise asyncio.CancelledError

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    with pytest.raises(asyncio.CancelledError):
        await get_batch_job_status(SPEECH_URL)
    assert not _points(tel, METRIC_SPEECH_CALL_DURATION)


# Configuration reference --------------------------------------------------------------------


async def test_queued_job_carries_its_configuration_reference(tel, mocker, monkeypatch):
    monkeypatch.setenv("AZURE_SPEECH_REGION", "uksouth")
    get_settings.cache_clear()

    async def post(self, url, **kwargs):
        post.payload = kwargs["json"]
        return _response(201, "POST", url, headers={"Location": SPEECH_URL})

    job = await _submit(mocker, post)
    (queued,) = tel.events("job.queued")
    assert queued[c.DEPENDENCY_REF] == SPEECH_JOB_ID
    assert queued["speech.region"] == "uksouth"
    assert queued["speech.locale"] == "en-GB"
    assert queued["speech.api_version"] == "v3.2"
    assert queued["speech.diarization"] is True
    # Azure-side diagnostics trace back to our job: displayName carries its ID only.
    assert post.payload["displayName"] == f"batch-{job.id}"
    tel.assert_no_prohibited_content(SAS_SIGNATURE, FILE_STEM)


async def test_finished_job_carries_the_model_azure_used_never_its_url(tel):
    model_url = f"{ENDPOINT}/speechtotext/v3.2/models/base/{MODEL_ID}"
    await _poll(
        _service(),
        _pending(locale="cy-GB", enable_diarization=False),
        {"status": "Succeeded", "model": {"self": model_url}},
    )
    (finished,) = tel.events("job.finished")
    assert finished[c.OUTCOME] == "success"
    assert finished["speech.model_ref"] == MODEL_ID
    assert finished["speech.locale"] == "cy-GB"
    assert finished["speech.diarization"] is False
    assert finished[c.DEPENDENCY_REF] == SPEECH_JOB_ID
    assert "hmcts.failure.source" not in finished
    tel.assert_no_prohibited_content(model_url)


@pytest.mark.parametrize(
    ("endpoint", "configured", "region"),
    [
        ("https://uksouth.api.cognitive.microsoft.com", None, "uksouth"),
        ("https://ukwest.stt.speech.microsoft.com", None, "ukwest"),
        ("https://jaia-dev-speech.cognitiveservices.azure.com", None, None),  # as deployed
        ("https://jaia-dev-speech.cognitiveservices.azure.com", "UKSouth", "uksouth"),
        ("https://uksouth.api.cognitive.microsoft.com", "not a region!", "uksouth"),
        ("not a url", None, None),
    ],
)
def test_region_comes_from_settings_or_a_regional_endpoint(
    monkeypatch, endpoint, configured, region
):
    monkeypatch.setenv("AZURE_SPEECH_ENDPOINT", endpoint)
    if configured is not None:
        monkeypatch.setenv("AZURE_SPEECH_REGION", configured)
    get_settings.cache_clear()
    assert speech_telemetry.speech_region() == region


def test_configuration_reference_drops_what_does_not_match():
    attributes = speech_telemetry.speech_config_attributes(
        "english", None, {"model": {"self": f"{ENDPOINT}/models/base/not-a-guid"}}
    )
    assert attributes == {"speech.api_version": "v3.2"}


# Quota and concurrency ----------------------------------------------------------------------


def _counts(running: int) -> JobStateCounts:
    return JobStateCounts(
        waiting=0, running=running, oldest_waiting_created=None, stuck_waiting=0, stuck_running=0
    )


def test_utilisation_gauge_reports_running_jobs_against_a_configured_limit(tel, monkeypatch):
    monkeypatch.setenv("SPEECH_CONCURRENT_JOBS_LIMIT", "40")
    get_settings.cache_clear()
    gauges = JobStateGauges(MagicMock())
    gauges.snapshot = MagicMock(return_value=_counts(30))
    gauges.register(get_meter())
    (point,) = _points(tel, METRIC_SPEECH_UTILISATION)
    assert point["value"] == pytest.approx(0.75)


def test_no_utilisation_gauge_without_a_limit(tel):
    gauges = JobStateGauges(MagicMock())
    gauges.snapshot = MagicMock(return_value=_counts(30))
    gauges.register(get_meter())
    assert not _points(tel, METRIC_SPEECH_UTILISATION)


def test_concurrency_limit_must_be_positive():
    from pydantic import ValidationError

    from transcription_svc.config.settings import Settings

    with pytest.raises(ValidationError):
        Settings(SPEECH_CONCURRENT_JOBS_LIMIT=0)


# Schema ---------------------------------------------------------------------------------------


def test_speech_attributes_are_registered_and_constrained(tel):
    from hmcts_otel import default_schema

    source = default_schema.get_attribute("hmcts.failure.source")
    assert source.allowed_values == {"application", "queue", "dependency"}
    code = default_schema.get_attribute("speech.error_code")
    assert code.check("InvalidData", default_schema.redactor) == ("InvalidData", None)
    assert code.check("bad code", default_schema.redactor)[1] == "pattern"
    for name in ("job.finished", "job.poll_failed", "job.retried"):
        attributes = default_schema.get_event(name).attributes
        assert {"hmcts.failure.source", "speech.retry_after_s"} <= set(attributes), name
    assert "speech.region" in default_schema.get_event("job.queued").attributes
    assert "hmcts.failure.source" in default_schema.get_event("job.stuck").attributes
