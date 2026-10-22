"""DIAAT-286: which requests are audited, and how (audit_log rows, captured).

AC1: an investigator can tell whether a sensitive action happened and whether it
succeeded: viewed (transcript returned), exported (audio streamed), deleted,
submitted, and refused (the DIAAT-285 blocked and detected sites). One insert per
request; actor is the internal user ID; the request ID joins the row to the
security.ownership_violation event. A failed audit write never breaks the request.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

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


def test_list_records_one_view_per_returned_transcript_in_one_insert(mocker, audit_capture):
    done, running = _job(), _job(status=JobStatus.RUNNING)
    mocker.patch(f"{ROUTES}.list_jobs_paginated", return_value=([done, running], 2))

    assert _client().get("/api/v1/jobs").status_code == 200

    row = _only_row(audit_capture)
    assert _summary(row) == ("transcript.view", "success", "job", done.id, {"via": "list"})


def test_list_without_transcripts_writes_nothing(mocker, audit_capture):
    mocker.patch(
        f"{ROUTES}.list_jobs_paginated", return_value=([_job(status=JobStatus.RUNNING)], 1)
    )

    assert _client().get("/api/v1/jobs").status_code == 200
    assert audit_capture.inserts == []


def test_list_refusal_and_views_share_one_insert(tel, mocker, audit_capture):
    own, foreign = _job(), _job(OWNER_ID)
    mocker.patch(f"{ROUTES}.list_jobs_paginated", return_value=([own, foreign], 2))

    assert _client().get("/api/v1/jobs").status_code == 200

    (rows,) = audit_capture.inserts
    assert sorted(map(_summary, rows), key=str) == sorted(
        [
            (
                "transcript.view",
                "denied",
                "job",
                foreign.id,
                {"reason": "ownership_assertion_failed"},
            ),
            ("transcript.view", "success", "job", own.id, {"via": "list"}),
        ],
        key=str,
    )
    (event,) = tel.events(EVENT_OWNERSHIP_VIOLATION)
    assert {row["request_id"] for row in rows} == {event[c.REQUEST_ID]}


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
