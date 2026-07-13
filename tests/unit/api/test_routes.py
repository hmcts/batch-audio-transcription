"""Unit tests for API routes."""

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from transcription_svc.api.app import create_app
from transcription_svc.database.models import Caller, JobStatus, TranscriptionJob


def _make_caller() -> Caller:
    return Caller(
        id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        name="test-caller",
        hashed_key="",
        webhook_secret="test-secret",
        is_active=True,
    )


def _make_job(status: JobStatus = JobStatus.PENDING) -> TranscriptionJob:
    from datetime import UTC, datetime

    job = TranscriptionJob(
        id=uuid.uuid4(),
        caller_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        audio_url="https://storage.example.com/audio.wav?sig=token",
        locale="en-GB",
        status=status,
        metadata_={},
        dialogue_entries=[],
    )
    job.created_datetime = datetime(2026, 1, 1, tzinfo=UTC)
    return job


@pytest.fixture
def client():
    app = create_app()
    return TestClient(app)


@pytest.fixture
def as_caller(client):
    from transcription_svc.api.dependencies import get_caller

    caller = _make_caller()
    app = client.app
    app.dependency_overrides[get_caller] = lambda: caller
    yield
    app.dependency_overrides.pop(get_caller, None)


class TestHealth:
    def test_returns_ok(self, client):
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_no_auth_required(self, client):
        response = client.get("/api/v1/health")
        assert response.status_code == 200


class TestUploadAudio:
    def _mock_blob_manager(self, mocker, *, upload_ok=True, sas_url="https://x/y.wav?sig=abc"):
        manager = mocker.AsyncMock()
        manager.create_blob_from_bytes = mocker.AsyncMock(return_value=upload_ok)
        manager.generate_read_sas_url = mocker.AsyncMock(return_value=sas_url)
        manager.__aenter__ = mocker.AsyncMock(return_value=manager)
        manager.__aexit__ = mocker.AsyncMock(return_value=False)
        mocker.patch("transcription_svc.api.routes.AsyncAzureBlobManager", return_value=manager)
        return manager

    def test_returns_201_with_audio_url(self, client, as_caller, mocker):
        self._mock_blob_manager(mocker)

        response = client.post(
            "/api/v1/uploads",
            files={"file": ("hearing.wav", b"fake-audio-bytes", "audio/wav")},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["audio_url"] == "https://x/y.wav?sig=abc"
        assert "hearing.wav" in body["blob_name"]

    def test_rejects_unsupported_extension(self, client, as_caller):
        response = client.post(
            "/api/v1/uploads",
            files={"file": ("notes.txt", b"hello", "text/plain")},
        )
        assert response.status_code == 422

    def test_returns_502_when_storage_upload_fails(self, client, as_caller, mocker):
        self._mock_blob_manager(mocker, upload_ok=False)

        response = client.post(
            "/api/v1/uploads",
            files={"file": ("hearing.wav", b"fake-audio-bytes", "audio/wav")},
        )
        assert response.status_code == 502

    def test_requires_auth(self, client):
        response = client.post(
            "/api/v1/uploads",
            files={"file": ("hearing.wav", b"fake-audio-bytes", "audio/wav")},
        )
        assert response.status_code in (401, 422)


class TestSubmitJob:
    def test_returns_201_on_success(self, client, as_caller, mocker):
        job = _make_job()
        mocker.patch(
            "transcription_svc.api.routes.submit_and_queue_batch_job",
            return_value=job,
        )
        mocker.patch("transcription_svc.api.routes.get_job_by_idempotency_key", return_value=None)

        response = client.post(
            "/api/v1/jobs",
            json={"audio_url": "https://storage.example.com/audio.wav?sig=token"},
        )
        assert response.status_code == 201
        assert "job_id" in response.json()

    def test_returns_existing_job_on_idempotency_hit(self, client, as_caller, mocker):
        existing = _make_job(status=JobStatus.SUCCEEDED)
        mocker.patch(
            "transcription_svc.api.routes.get_job_by_idempotency_key", return_value=existing
        )

        response = client.post(
            "/api/v1/jobs",
            json={
                "audio_url": "https://storage.example.com/audio.wav?sig=token",
                "idempotency_key": "my-key",
            },
        )
        assert response.status_code == 201
        assert response.json()["status"] == "succeeded"

    def test_requires_auth(self, client):
        response = client.post(
            "/api/v1/jobs",
            json={"audio_url": "https://storage.example.com/audio.wav"},
        )
        assert response.status_code in (401, 422)


class TestListJobs:
    def test_returns_jobs_for_caller(self, client, as_caller, mocker):
        jobs = [_make_job(status=JobStatus.SUCCEEDED), _make_job(status=JobStatus.RUNNING)]
        mocker.patch("transcription_svc.api.routes.list_jobs_by_caller", return_value=jobs)

        response = client.get("/api/v1/jobs")
        assert response.status_code == 200
        body = response.json()
        assert len(body["jobs"]) == 2
        assert body["jobs"][0]["status"] == "succeeded"

    def test_returns_empty_list_when_no_jobs(self, client, as_caller, mocker):
        mocker.patch("transcription_svc.api.routes.list_jobs_by_caller", return_value=[])

        response = client.get("/api/v1/jobs")
        assert response.status_code == 200
        assert response.json()["jobs"] == []

    def test_requires_auth(self, client):
        response = client.get("/api/v1/jobs")
        assert response.status_code in (401, 422)


class TestGetJob:
    def test_returns_job(self, client, as_caller, mocker):
        job = _make_job()
        caller = _make_caller()
        job.caller_id = caller.id
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.get(f"/api/v1/jobs/{job.id}")
        assert response.status_code == 200

    def test_returns_404_for_unknown_job(self, client, as_caller, mocker):
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=None)
        response = client.get(f"/api/v1/jobs/{uuid.uuid4()}")
        assert response.status_code == 404

    def test_returns_404_for_other_callers_job(self, client, as_caller, mocker):
        job = _make_job()
        job.caller_id = uuid.uuid4()  # different caller
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.get(f"/api/v1/jobs/{job.id}")
        assert response.status_code == 404


class TestDeleteJob:
    def test_returns_204(self, client, as_caller, mocker):
        from transcription_svc.database.engine import get_session

        job = _make_job()
        caller = _make_caller()
        job.caller_id = caller.id
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        mock_session = MagicMock()
        client.app.dependency_overrides[get_session] = lambda: mock_session

        try:
            response = client.delete(f"/api/v1/jobs/{job.id}")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 204
        mock_session.delete.assert_called_once_with(job)
        mock_session.commit.assert_called_once()
