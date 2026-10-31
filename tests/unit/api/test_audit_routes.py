"""DIAAT-286: which requests are audited, and how (audit_log rows, captured).

AC1: an investigator can tell whether a sensitive action happened and whether it
succeeded: viewed (GET /jobs/{id} returned a transcript; the list is not a view),
exported (audio streamed), deleted, submitted, and refused (the DIAAT-285 blocked and
detected sites). One insert per request; actor is the internal user ID; the request
ID joins the row to the security.ownership_violation event. A failed audit write never
breaks the request.
"""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient
from hmcts_otel import conventions as c
from hmcts_otel.testing import capture_telemetry

from transcription_svc import audit
from transcription_svc.config.settings import get_settings
from transcription_svc.database.models import JobStatus, TranscriptionJob, User
from transcription_svc.telemetry import (
    EVENT_AUDIT_WRITE_FAILED,
    EVENT_OWNERSHIP_VIOLATION,
    configure_telemetry,
)

ROUTES = "transcription_svc.api.routes"
CALLER_ID = uuid.UUID("00000000-0000-4000-8000-0000000000c1")
CALLER_EMAIL = "caller@example.com"
OWNER_ID = uuid.UUID("00000000-0000-4000-8000-0000000000a2")
UPLOAD_ID = uuid.UUID("6f1c2d3e-4b5a-4c6d-8e7f-001122334455")
TRANSCRIPT_TEXT = "the appellant said something confidential"


@pytest.fixture
def tel():
    with capture_telemetry() as capture:
        configure_telemetry()
        yield capture


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    from transcription_svc.api.routes import limiter

    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def local_audio(monkeypatch, mocker):
    monkeypatch.setenv("AUDIO_STORAGE_BACKEND", "local")
    get_settings.cache_clear()
    storage = mocker.patch(f"{ROUTES}.local_storage")
    storage.size.return_value = 10
    storage.read_range.return_value = b"0123456789"
    return storage


def _job(
    user_id: uuid.UUID | None = CALLER_ID, status: JobStatus = JobStatus.SUCCEEDED
) -> TranscriptionJob:
    job = TranscriptionJob(
        id=uuid.uuid4(),
        user_id=user_id,
        audio_url="https://storage.example.com/x/hearing.wav",
        audio_blob_path=f"uploads/{user_id}/{UPLOAD_ID}-hearing.wav",
        locale="en-GB",
        status=status,
        metadata_={},
        dialogue_entries=(
            [{"speaker": "Speaker 1", "text": TRANSCRIPT_TEXT, "start_time": 0.0, "end_time": 1.0}]
            if status == JobStatus.SUCCEEDED
            else []
        ),
    )
    job.created_datetime = datetime(2026, 1, 1, tzinfo=UTC)
    return job


def _client(roles: list[str] | None = None) -> TestClient:
    from transcription_svc.api.app import create_app
    from transcription_svc.database.engine import get_session
    from transcription_svc.utils.auth_models import AuthenticatedUser
    from transcription_svc.utils.dependencies import get_current_user

    user = User(
        id=CALLER_ID,
        azure_user_id="caller-azure-oid",
        email=CALLER_EMAIL,
        role="Normal",
        created_datetime=datetime(2026, 1, 1, tzinfo=UTC),
    )
    app = create_app()
    current = AuthenticatedUser(db_user=user, app_roles=roles or ["Normal"])
    app.dependency_overrides[get_current_user] = lambda: current
    app.dependency_overrides[get_session] = lambda: MagicMock()  # no database here
    return TestClient(app, raise_server_exceptions=False)


def _only_row(audit_capture) -> dict:
    (insert,) = audit_capture.inserts  # one insert per audited request
    (row,) = insert
    return row


def _summary(row: dict) -> tuple:
    return (row["action"], row["outcome"], row["object_type"], row["object_id"], row["detail"])


def _assert_safe(row: dict) -> None:
    """Only the internal user ID identifies the actor; nothing carries content."""
    assert row["actor_id"] == CALLER_ID
    flat = repr(row)
    for value in (CALLER_EMAIL, "caller-azure-oid", TRANSCRIPT_TEXT, "hearing.wav"):
        assert value not in flat


# viewed ------------------------------------------------------------------------------------


def test_job_detail_with_a_transcript_is_a_view(mocker, audit_capture):
    job = _job()
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)

    response = _client().get(f"/api/v1/jobs/{job.id}")

    assert response.status_code == 200
    row = _only_row(audit_capture)
    assert _summary(row) == ("transcript.view", "success", "job", job.id, None)
    assert row["request_id"] == response.headers["X-Request-Id"]
    _assert_safe(row)


def test_job_detail_without_a_transcript_is_not_a_view(mocker, audit_capture):
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=_job(status=JobStatus.RUNNING))

    assert _client().get(f"/api/v1/jobs/{uuid.uuid4()}").status_code == 200
    assert audit_capture.inserts == []


def test_unknown_job_is_not_audited(mocker, audit_capture):
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=None)

    assert _client().get(f"/api/v1/jobs/{uuid.uuid4()}").status_code == 404
    assert audit_capture.inserts == []


def test_failure_building_the_detail_after_authorisation_is_failed(mocker, audit_capture):
    job = _job()
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)
    mocker.patch(f"{ROUTES}._to_response", side_effect=RuntimeError(TRANSCRIPT_TEXT))

    assert _client().get(f"/api/v1/jobs/{job.id}").status_code == 500
    row = _only_row(audit_capture)
    assert _summary(row) == ("transcript.view", "failed", "job", job.id, {"reason": "error"})
    _assert_safe(row)


def test_administrator_view_of_another_users_job_names_the_administrator(mocker, audit_capture):
    job = _job(OWNER_ID)
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)

    assert _client(["SystemAdministrator"]).get(f"/api/v1/jobs/{job.id}").status_code == 200
    row = _only_row(audit_capture)
    assert _summary(row) == ("transcript.view", "success", "job", job.id, None)
    assert row["actor_id"] == CALLER_ID


def test_list_view_writes_no_view_rows(mocker, audit_capture):
    # The dashboard polls the list every 5 s: views are audited by GET /jobs/{id} only,
    # even though the list returns the transcripts.
    done, running = _job(), _job(status=JobStatus.RUNNING)
    mocker.patch(f"{ROUTES}.list_jobs_paginated", return_value=([done, running], 2))

    response = _client().get("/api/v1/jobs")

    assert response.status_code == 200
    assert TRANSCRIPT_TEXT in response.text  # a transcript was returned...
    assert audit_capture.inserts == []  # ...and still nothing was written


def test_list_without_transcripts_writes_nothing(mocker, audit_capture):
    mocker.patch(
        f"{ROUTES}.list_jobs_paginated", return_value=([_job(status=JobStatus.RUNNING)], 1)
    )

    assert _client().get("/api/v1/jobs").status_code == 200
    assert audit_capture.inserts == []


def test_list_records_only_the_refusal(tel, mocker, audit_capture):
    own, foreign = _job(), _job(OWNER_ID)
    mocker.patch(f"{ROUTES}.list_jobs_paginated", return_value=([own, foreign], 2))

    assert _client().get("/api/v1/jobs").status_code == 200

    row = _only_row(audit_capture)  # the refusal; the caller's own transcript is no row
    assert _summary(row) == (
        "transcript.view",
        "denied",
        "job",
        foreign.id,
        {"reason": "ownership_assertion_failed"},
    )
    (event,) = tel.events(EVENT_OWNERSHIP_VIOLATION)
    assert row["request_id"] == event[c.REQUEST_ID]


# exported ----------------------------------------------------------------------------------


def test_audio_stream_is_an_export(local_audio, mocker, audit_capture):
    job = _job()
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)

    response = _client().get(f"/api/v1/jobs/{job.id}/audio")

    assert response.status_code == 200
    row = _only_row(audit_capture)
    assert _summary(row) == ("audio.export", "success", "job", job.id, {"partial": False})
    _assert_safe(row)


def test_audio_range_request_is_a_partial_export(local_audio, mocker, audit_capture):
    job = _job()
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)

    response = _client().get(f"/api/v1/jobs/{job.id}/audio", headers={"Range": "bytes=0-3"})

    assert response.status_code == 206
    assert _summary(_only_row(audit_capture))[4] == {"partial": True}


def test_audio_missing_after_authorisation_is_a_failed_export(local_audio, mocker, audit_capture):
    job = _job()
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)
    local_audio.size.side_effect = FileNotFoundError(job.audio_blob_path)

    assert _client().get(f"/api/v1/jobs/{job.id}/audio").status_code == 404
    row = _only_row(audit_capture)
    assert _summary(row) == ("audio.export", "failed", "job", job.id, {"reason": "http_404"})
    _assert_safe(row)


# deleted -----------------------------------------------------------------------------------


def test_delete_is_audited_after_the_row_is_deleted(local_audio, mocker, audit_capture):
    job = _job()
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)
    session = mocker.MagicMock()
    from transcription_svc.database.engine import get_session

    client = _client()
    client.app.dependency_overrides[get_session] = lambda: session

    def committed(*_):
        # The record is written only after the deletion is committed.
        assert audit_capture.inserts == []

    session.commit.side_effect = committed

    assert client.delete(f"/api/v1/jobs/{job.id}").status_code == 204
    session.delete.assert_called_once_with(job)
    row = _only_row(audit_capture)
    assert _summary(row) == ("job.delete", "success", "job", job.id, None)


def test_delete_that_keeps_the_job_is_failed(local_audio, mocker, audit_capture):
    job = _job()
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)
    local_audio.delete.side_effect = OSError("disk")

    assert _client().delete(f"/api/v1/jobs/{job.id}").status_code == 502
    row = _only_row(audit_capture)
    assert _summary(row) == ("job.delete", "failed", "job", job.id, {"reason": "http_502"})


# submitted ---------------------------------------------------------------------------------


def _submit(client: TestClient, **body):
    return client.post("/api/v1/jobs", json={"audio_url": "https://x.example.com/a.wav", **body})


def test_submission_is_audited_with_the_new_job(mocker, audit_capture):
    job = _job(status=JobStatus.SUBMITTED)
    mocker.patch(f"{ROUTES}.submit_and_queue_batch_job", return_value=job)

    assert _submit(_client()).status_code == 201
    row = _only_row(audit_capture)
    assert _summary(row) == ("job.submit", "success", "job", job.id, None)


def test_idempotent_replay_is_audited_as_a_replay(mocker, audit_capture):
    job = _job(status=JobStatus.SUBMITTED)
    mocker.patch(f"{ROUTES}.get_job_by_idempotency_key_for_user", return_value=job)
    submit = mocker.patch(f"{ROUTES}.submit_and_queue_batch_job")

    assert _submit(_client(), idempotency_key="k1").status_code == 201
    submit.assert_not_called()
    row = _only_row(audit_capture)
    assert _summary(row) == ("job.submit", "success", "job", job.id, {"replayed": True})


def test_failed_submission_is_audited_as_failed(mocker, audit_capture):
    mocker.patch(f"{ROUTES}.submit_and_queue_batch_job", side_effect=RuntimeError("azure"))

    assert _submit(_client()).status_code == 500
    row = _only_row(audit_capture)
    assert _summary(row) == ("job.submit", "failed", "job", None, {"reason": "error"})


def test_foreign_upload_is_one_denied_record_naming_the_upload(tel, mocker, audit_capture):
    blob = f"uploads/{OWNER_ID}/{UPLOAD_ID}-PA_50123_2024 Smith v Home Office.wav"
    mocker.patch(f"{ROUTES}.get_job_by_idempotency_key_for_user", return_value=None)
    mocker.patch(f"{ROUTES}.submit_and_queue_batch_job")

    assert _submit(_client(), blob_name=blob).status_code == 422
    row = _only_row(audit_capture)  # the refusal only: not also a "failed" submission
    assert _summary(row) == ("job.submit", "denied", "upload", UPLOAD_ID, {"reason": "not_owner"})
    assert "Smith" not in repr(row) and "PA_50123_2024" not in repr(row)
    (event,) = tel.events(EVENT_OWNERSHIP_VIOLATION)
    assert row["request_id"] == event[c.REQUEST_ID]


# refused (DIAAT-285 blocked and detected) ---------------------------------------------------


def _call(client: TestClient, route: str, job_id: uuid.UUID):
    if route == "get":
        return client.get(f"/api/v1/jobs/{job_id}")
    if route == "audio":
        return client.get(f"/api/v1/jobs/{job_id}/audio")
    if route == "delete":
        return client.delete(f"/api/v1/jobs/{job_id}")
    if route == "correct":
        return client.patch(f"/api/v1/jobs/{job_id}/segments/0", json={"corrected_text": "x"})
    if route == "baseline":
        return client.post(
            f"/api/v1/jobs/{job_id}/baseline", files={"file": ("b.txt", b"hello", "text/plain")}
        )
    raise AssertionError(route)


@pytest.mark.parametrize(
    ("route", "action"),
    [
        ("get", "transcript.view"),
        ("audio", "audio.export"),
        ("delete", "job.delete"),
        ("correct", "transcript.edit"),
        ("baseline", "transcript.edit"),
    ],
)
@pytest.mark.parametrize(
    ("owner", "reason"), [(OWNER_ID, "not_owner"), (None, "legacy_job")], ids=["other", "legacy"]
)
def test_blocked_access_is_a_denied_record(
    tel, mocker, audit_capture, route, action, owner, reason
):
    job = _job(owner)
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)

    response = _call(_client(), route, job.id)

    assert (response.status_code, response.json()) == (404, {"detail": "Job not found"})
    row = _only_row(audit_capture)
    assert _summary(row) == (action, "denied", "job", job.id, {"reason": reason})
    (event,) = tel.events(EVENT_OWNERSHIP_VIOLATION)
    assert row["request_id"] == event[c.REQUEST_ID] == response.headers["X-Request-Id"]
    _assert_safe(row)


@pytest.mark.parametrize(
    ("route", "action"), [("get", "transcript.view"), ("audio", "audio.export")]
)
def test_detected_access_is_a_denied_record(tel, mocker, audit_capture, route, action):
    mocker.patch(f"{ROUTES}._check_job_access")  # a broken authorisation check
    job = _job(OWNER_ID)
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)

    assert _call(_client(), route, job.id).status_code == 404
    row = _only_row(audit_capture)
    assert _summary(row) == (
        action,
        "denied",
        "job",
        job.id,
        {"reason": "ownership_assertion_failed"},
    )


# fail-open ---------------------------------------------------------------------------------


@pytest.mark.parametrize("route", ["get", "audio", "delete"])
def test_a_failed_audit_write_never_breaks_the_request(
    tel, local_audio, mocker, monkeypatch, route
):
    def broken(rows):
        raise ConnectionError("database down")

    monkeypatch.setattr(audit, "_insert", broken)
    job = _job()
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)

    response = _call(_client(), route, job.id)

    assert response.status_code in (200, 204)
    (event,) = tel.events(EVENT_AUDIT_WRITE_FAILED)
    assert event[c.REQUEST_ID] == response.headers["X-Request-Id"]
    # The event and the log line name nothing: not the job, the user or any content.
    logs = [r for r in tel.log_records() if "Audit record" in str(r.body)]
    assert len(logs) == 1
    for exported in (event, logs[0].body, dict(logs[0].attributes or {})):
        flat = repr(exported)
        for value in (str(job.id), str(CALLER_ID), CALLER_EMAIL, TRANSCRIPT_TEXT, "database down"):
            assert value not in flat


def test_a_failed_audit_write_never_changes_a_refusal(tel, mocker, monkeypatch):
    monkeypatch.setattr(audit, "_insert", lambda rows: 1 / 0)
    job = _job(OWNER_ID)
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)

    response = _client().get(f"/api/v1/jobs/{job.id}")

    assert (response.status_code, response.json()) == (404, {"detail": "Job not found"})
    assert tel.events(EVENT_AUDIT_WRITE_FAILED)
    assert tel.events(EVENT_OWNERSHIP_VIOLATION)


# off the event loop ------------------------------------------------------------------------


class _ThreadRecorder:
    """An audit insert that records where it ran (and where its rows were built)."""

    def __init__(self, monkeypatch, delay: float = 0.0) -> None:
        self.inserts: list[list[dict]] = []
        self.insert_threads: list[threading.Thread] = []
        self.insert_on_loop: list[bool] = []
        self.rows_threads: list[threading.Thread] = []
        self._delay = delay
        real_rows = audit._rows

        def rows(records):
            self.rows_threads.append(threading.current_thread())
            return real_rows(records)

        monkeypatch.setattr(audit, "_rows", rows)
        monkeypatch.setattr(audit, "_insert", self)

    def __call__(self, rows: list[dict]) -> None:
        self.insert_threads.append(threading.current_thread())
        try:
            asyncio.get_running_loop()
            self.insert_on_loop.append(True)
        except RuntimeError:
            self.insert_on_loop.append(False)
        time.sleep(self._delay)  # a slow database, blocking whichever thread runs it
        self.inserts.append(list(rows))

    def assert_off_loop(self) -> None:
        assert self.inserts, "nothing was written"
        assert self.insert_on_loop == [False] * len(self.inserts)
        # The rows (request ID, timestamp) were built on the event loop; inserted elsewhere.
        for built, inserted in zip(self.rows_threads, self.insert_threads, strict=True):
            assert inserted is not built


def _write_route(route: str, mocker) -> tuple[str, str, dict]:
    """A request that writes an audit row: audited() or a direct denial write."""
    if route == "view":  # async with audited(...)
        job = _job()
        mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)
        return "GET", f"/api/v1/jobs/{job.id}", {}
    if route == "delete":  # async with audited(...)
        job = _job()
        mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)
        return "DELETE", f"/api/v1/jobs/{job.id}", {}
    if route == "blocked":  # _check_job_access's denial
        job = _job(OWNER_ID)
        mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)
        return "GET", f"/api/v1/jobs/{job.id}", {}
    if route == "detected":  # _assert_job_owner's denial
        mocker.patch(f"{ROUTES}._check_job_access")
        job = _job(OWNER_ID)
        mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)
        return "GET", f"/api/v1/jobs/{job.id}", {}
    if route == "list":  # the job list's refusals
        mocker.patch(f"{ROUTES}.list_jobs_paginated", return_value=([_job(OWNER_ID)], 1))
        return "GET", "/api/v1/jobs", {}
    if route == "foreign_upload":  # the submission's refusal
        mocker.patch(f"{ROUTES}.get_job_by_idempotency_key_for_user", return_value=None)
        mocker.patch(f"{ROUTES}.submit_and_queue_batch_job")
        blob = f"uploads/{OWNER_ID}/{UPLOAD_ID}-hearing.wav"
        body = {"audio_url": "https://x.example.com/a.wav", "blob_name": blob}
        return "POST", "/api/v1/jobs", {"json": body}
    raise AssertionError(route)


_WRITE_ROUTES = ["view", "delete", "blocked", "detected", "list", "foreign_upload"]


@pytest.mark.parametrize("route", _WRITE_ROUTES)
def test_audit_rows_are_inserted_off_the_event_loop(local_audio, mocker, monkeypatch, route):
    recorder = _ThreadRecorder(monkeypatch)
    method, url, kwargs = _write_route(route, mocker)

    response = _client().request(method, url, **kwargs)

    assert response.status_code < 500
    assert len(recorder.inserts) == 1  # still one insert per request
    recorder.assert_off_loop()
    (row,) = recorder.inserts[0]
    assert row["request_id"] == response.headers["X-Request-Id"]


@pytest.mark.parametrize("route", _WRITE_ROUTES)
async def test_a_slow_audit_write_does_not_block_the_event_loop(
    local_audio, mocker, monkeypatch, route
):
    """While one request's audit insert blocks for 0.3 s, the event loop keeps running,
    and the row is written before that request's response arrives."""
    delay = 0.3
    recorder = _ThreadRecorder(monkeypatch, delay=delay)
    method, url, kwargs = _write_route(route, mocker)
    app = _client().app
    ticks = 0
    done = asyncio.Event()

    async def ticker():
        nonlocal ticks
        while not done.is_set():
            await asyncio.sleep(0.01)
            ticks += 1

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        ticking = asyncio.create_task(ticker())
        started = time.perf_counter()
        response = await client.request(method, url, **kwargs)
        elapsed = time.perf_counter() - started
        # The row is in before the response completed (awaited, not fire-and-forget).
        assert len(recorder.inserts) == 1
        done.set()
        await ticking

    assert response.status_code < 500
    assert elapsed >= delay
    # A blocked loop would tick at most once or twice in that time; a free one ~30 times.
    assert ticks >= 10
    (row,) = recorder.inserts[0]
    assert row["request_id"] == response.headers["X-Request-Id"]


async def test_a_failed_off_loop_write_never_breaks_the_request(tel, mocker, monkeypatch):
    seen: list[bool] = []

    def broken(rows):
        try:
            asyncio.get_running_loop()
            seen.append(True)
        except RuntimeError:
            seen.append(False)
        raise ConnectionError("database down")

    monkeypatch.setattr(audit, "_insert", broken)
    job = _job()
    mocker.patch(f"{ROUTES}.get_job_by_id", return_value=job)
    transport = httpx.ASGITransport(app=_client().app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(f"/api/v1/jobs/{job.id}")

    assert response.status_code == 200
    assert seen == [False]  # it failed in the worker thread...
    (event,) = tel.events(EVENT_AUDIT_WRITE_FAILED)  # ...and was reported for the request
    assert event[c.REQUEST_ID] == response.headers["X-Request-Id"]
