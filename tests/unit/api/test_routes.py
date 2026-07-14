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
    def _mock_blob_manager(self, mocker, *, upload_ok=True, blob_url="https://x/y.wav"):
        manager = mocker.AsyncMock()
        manager.create_blob_from_bytes = mocker.AsyncMock(return_value=upload_ok)
        manager.build_blob_url = mocker.Mock(return_value=blob_url)
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
        assert body["audio_url"] == "https://x/y.wav"
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


class TestUploadAudioLocalBackend:
    @pytest.fixture(autouse=True)
    def local_backend(self, tmp_path, monkeypatch):
        from transcription_svc.config.settings import get_settings

        monkeypatch.setenv("AUDIO_STORAGE_BACKEND", "local")
        monkeypatch.setenv("LOCAL_AUDIO_STORAGE_DIR", str(tmp_path))
        monkeypatch.setenv("LOCAL_AUDIO_BASE_URL", "https://abc123.ngrok-free.app")
        get_settings.cache_clear()
        yield
        get_settings.cache_clear()

    def test_stores_locally_and_returns_tunnel_url(self, client, as_caller):
        response = client.post(
            "/api/v1/uploads",
            files={"file": ("hearing.wav", b"fake-audio-bytes", "audio/wav")},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["audio_url"].startswith("https://abc123.ngrok-free.app/api/v1/local-audio/")

        get_response = client.get(body["audio_url"].replace("https://abc123.ngrok-free.app", ""))
        assert get_response.status_code == 200
        assert get_response.content == b"fake-audio-bytes"

    def test_never_touches_azure_blob_manager(self, client, as_caller, mocker):
        blob_manager_cls = mocker.patch("transcription_svc.api.routes.AsyncAzureBlobManager")

        client.post(
            "/api/v1/uploads",
            files={"file": ("hearing.wav", b"fake-audio-bytes", "audio/wav")},
        )

        blob_manager_cls.assert_not_called()


class TestLocalAudio:
    def test_404_when_backend_is_not_local(self, client):
        response = client.get("/api/v1/local-audio/uploads/x/hearing.wav")
        assert response.status_code == 404

    def test_404_for_path_traversal(self, tmp_path, monkeypatch, client):
        from transcription_svc.config.settings import get_settings

        monkeypatch.setenv("AUDIO_STORAGE_BACKEND", "local")
        monkeypatch.setenv("LOCAL_AUDIO_STORAGE_DIR", str(tmp_path))
        get_settings.cache_clear()

        response = client.get("/api/v1/local-audio/../../etc/passwd")

        get_settings.cache_clear()
        assert response.status_code == 404


class TestGetJobAudio:
    def test_returns_404_for_unknown_job(self, client, as_caller, mocker):
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=None)
        response = client.get(f"/api/v1/jobs/{uuid.uuid4()}/audio")
        assert response.status_code == 404

    def test_returns_404_for_other_callers_job(self, client, as_caller, mocker):
        job = _make_job()
        job.caller_id = uuid.uuid4()
        job.audio_blob_path = "uploads/x/hearing.wav"
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        response = client.get(f"/api/v1/jobs/{job.id}/audio")
        assert response.status_code == 404

    def test_returns_404_when_job_has_no_blob_path(self, client, as_caller, mocker):
        job = _make_job()
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.audio_blob_path = None
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        response = client.get(f"/api/v1/jobs/{job.id}/audio")
        assert response.status_code == 404

    def test_streams_full_content_from_local_backend(
        self, client, as_caller, mocker, tmp_path, monkeypatch
    ):
        from transcription_svc.audio import local_storage
        from transcription_svc.config.settings import get_settings

        monkeypatch.setenv("AUDIO_STORAGE_BACKEND", "local")
        monkeypatch.setenv("LOCAL_AUDIO_STORAGE_DIR", str(tmp_path))
        get_settings.cache_clear()

        blob_name = "uploads/x/hearing.wav"
        local_storage.save(b"fake-audio-bytes", blob_name)

        job = _make_job()
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.audio_blob_path = blob_name
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.get(f"/api/v1/jobs/{job.id}/audio")
        get_settings.cache_clear()

        assert response.status_code == 200
        assert response.content == b"fake-audio-bytes"
        assert response.headers["accept-ranges"] == "bytes"
        assert response.headers["content-length"] == "16"

    def test_streams_partial_range_from_local_backend(
        self, client, as_caller, mocker, tmp_path, monkeypatch
    ):
        from transcription_svc.audio import local_storage
        from transcription_svc.config.settings import get_settings

        monkeypatch.setenv("AUDIO_STORAGE_BACKEND", "local")
        monkeypatch.setenv("LOCAL_AUDIO_STORAGE_DIR", str(tmp_path))
        get_settings.cache_clear()

        blob_name = "uploads/x/hearing.wav"
        local_storage.save(b"0123456789", blob_name)

        job = _make_job()
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.audio_blob_path = blob_name
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.get(f"/api/v1/jobs/{job.id}/audio", headers={"Range": "bytes=2-4"})
        get_settings.cache_clear()

        assert response.status_code == 206
        assert response.content == b"234"
        assert response.headers["content-range"] == "bytes 2-4/10"
        assert response.headers["content-length"] == "3"

    def test_returns_404_when_local_file_missing(
        self, client, as_caller, mocker, tmp_path, monkeypatch
    ):
        from transcription_svc.config.settings import get_settings

        monkeypatch.setenv("AUDIO_STORAGE_BACKEND", "local")
        monkeypatch.setenv("LOCAL_AUDIO_STORAGE_DIR", str(tmp_path))
        get_settings.cache_clear()

        job = _make_job()
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.audio_blob_path = "uploads/x/missing.wav"
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.get(f"/api/v1/jobs/{job.id}/audio")
        get_settings.cache_clear()

        assert response.status_code == 404

    def test_supports_suffix_range_for_the_last_n_bytes(
        self, client, as_caller, mocker, tmp_path, monkeypatch
    ):
        from transcription_svc.audio import local_storage
        from transcription_svc.config.settings import get_settings

        monkeypatch.setenv("AUDIO_STORAGE_BACKEND", "local")
        monkeypatch.setenv("LOCAL_AUDIO_STORAGE_DIR", str(tmp_path))
        get_settings.cache_clear()

        blob_name = "uploads/x/hearing.wav"
        local_storage.save(b"0123456789", blob_name)

        job = _make_job()
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.audio_blob_path = blob_name
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        # "bytes=-3" means "the last 3 bytes", not "bytes 0 to 3".
        response = client.get(f"/api/v1/jobs/{job.id}/audio", headers={"Range": "bytes=-3"})
        get_settings.cache_clear()

        assert response.status_code == 206
        assert response.content == b"789"
        assert response.headers["content-range"] == "bytes 7-9/10"

    def test_returns_416_for_a_malformed_range_header(
        self, client, as_caller, mocker, tmp_path, monkeypatch
    ):
        from transcription_svc.audio import local_storage
        from transcription_svc.config.settings import get_settings

        monkeypatch.setenv("AUDIO_STORAGE_BACKEND", "local")
        monkeypatch.setenv("LOCAL_AUDIO_STORAGE_DIR", str(tmp_path))
        get_settings.cache_clear()

        blob_name = "uploads/x/hearing.wav"
        local_storage.save(b"0123456789", blob_name)

        job = _make_job()
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.audio_blob_path = blob_name
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        # Multi-range requests aren't supported; this must not be silently
        # misinterpreted as the first sub-range.
        response = client.get(f"/api/v1/jobs/{job.id}/audio", headers={"Range": "bytes=0-1,2-3"})
        get_settings.cache_clear()

        assert response.status_code == 416
        assert response.headers["content-range"] == "bytes */10"

    def test_returns_416_for_an_out_of_bounds_range(
        self, client, as_caller, mocker, tmp_path, monkeypatch
    ):
        from transcription_svc.audio import local_storage
        from transcription_svc.config.settings import get_settings

        monkeypatch.setenv("AUDIO_STORAGE_BACKEND", "local")
        monkeypatch.setenv("LOCAL_AUDIO_STORAGE_DIR", str(tmp_path))
        get_settings.cache_clear()

        blob_name = "uploads/x/hearing.wav"
        local_storage.save(b"0123456789", blob_name)

        job = _make_job()
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.audio_blob_path = blob_name
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.get(f"/api/v1/jobs/{job.id}/audio", headers={"Range": "bytes=20-30"})
        get_settings.cache_clear()

        assert response.status_code == 416
        assert response.headers["content-range"] == "bytes */10"

    def test_streams_partial_range_from_azure_backend(self, client, as_caller, mocker):
        async def achunks(chunks):
            for c in chunks:
                yield c

        job = _make_job()
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.audio_blob_path = "uploads/x/hearing.wav"
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        manager = mocker.AsyncMock()
        manager.get_blob_size = mocker.AsyncMock(return_value=100)
        manager.stream_blob_range = mocker.MagicMock(return_value=achunks([b"partial-", b"bytes"]))
        manager.close = mocker.AsyncMock()
        manager.__aenter__ = mocker.AsyncMock(return_value=manager)
        manager.__aexit__ = mocker.AsyncMock(return_value=False)
        mocker.patch("transcription_svc.api.routes.AsyncAzureBlobManager", return_value=manager)

        response = client.get(f"/api/v1/jobs/{job.id}/audio", headers={"Range": "bytes=10-30"})

        assert response.status_code == 206
        assert response.content == b"partial-bytes"
        assert response.headers["content-range"] == "bytes 10-30/100"
        manager.stream_blob_range.assert_called_once_with("uploads/x/hearing.wav", 10, 21)
        manager.close.assert_awaited_once()

    def test_returns_404_when_azure_blob_missing(self, client, as_caller, mocker):
        job = _make_job()
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.audio_blob_path = "uploads/x/missing.wav"
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        manager = mocker.AsyncMock()
        manager.get_blob_size = mocker.AsyncMock(return_value=None)
        manager.__aenter__ = mocker.AsyncMock(return_value=manager)
        manager.__aexit__ = mocker.AsyncMock(return_value=False)
        mocker.patch("transcription_svc.api.routes.AsyncAzureBlobManager", return_value=manager)

        response = client.get(f"/api/v1/jobs/{job.id}/audio")

        assert response.status_code == 404


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

    def test_accepts_blob_name_under_callers_own_prefix(self, client, as_caller, mocker):
        job = _make_job()
        submit_mock = mocker.patch(
            "transcription_svc.api.routes.submit_and_queue_batch_job",
            return_value=job,
        )
        mocker.patch("transcription_svc.api.routes.get_job_by_idempotency_key", return_value=None)

        # as_caller's id is 00000000-0000-0000-0000-000000000001 (see _make_caller).
        own_blob_name = "uploads/00000000-0000-0000-0000-000000000001/audio.wav"
        response = client.post(
            "/api/v1/jobs",
            json={
                "audio_url": "https://storage.example.com/audio.wav?sig=token",
                "blob_name": own_blob_name,
            },
        )
        assert response.status_code == 201
        assert submit_mock.call_args.kwargs["audio_blob_path"] == own_blob_name

    def test_rejects_blob_name_belonging_to_another_caller(self, client, as_caller, mocker):
        # blob_name is later trusted by GET /jobs/{id}/audio to read straight
        # from storage — without this check a caller could read another
        # caller's audio by guessing/observing their blob path.
        mocker.patch(
            "transcription_svc.api.routes.submit_and_queue_batch_job",
            return_value=_make_job(),
        )
        mocker.patch("transcription_svc.api.routes.get_job_by_idempotency_key", return_value=None)

        response = client.post(
            "/api/v1/jobs",
            json={
                "audio_url": "https://storage.example.com/audio.wav?sig=token",
                "blob_name": "uploads/11111111-1111-1111-1111-111111111111/audio.wav",
            },
        )
        assert response.status_code == 422


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

    def test_includes_accuracy_and_needs_review_for_succeeded_job(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "hello there",
                "start_time": 0.0,
                "end_time": 1.0,
                "confidence": 0.5,
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.get(f"/api/v1/jobs/{job.id}")
        body = response.json()

        assert body["accuracy"]["confidence_score"] == 50.0
        assert body["accuracy"]["has_corrections"] is False
        assert body["accuracy"]["word_error_rate"] is None
        assert len(body["needs_review"]) == 1
        assert body["needs_review"][0]["speaker"] == "0"

    def test_omits_accuracy_for_non_succeeded_job(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUBMITTED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.get(f"/api/v1/jobs/{job.id}")
        body = response.json()

        assert body["accuracy"] is None
        assert body["needs_review"] is None


class TestCorrectSegment:
    def _patch_session(self, client, mocker):
        from transcription_svc.database.engine import get_session

        mock_session = MagicMock()
        client.app.dependency_overrides[get_session] = lambda: mock_session
        return mock_session

    def test_returns_404_for_unknown_job(self, client, as_caller, mocker):
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=None)
        response = client.patch(
            f"/api/v1/jobs/{uuid.uuid4()}/segments/0", json={"corrected_text": "fixed"}
        )
        assert response.status_code == 404

    def test_returns_404_for_other_callers_job(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.uuid4()
        job.dialogue_entries = [{"speaker": "0", "text": "hi", "start_time": 0, "end_time": 1}]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.patch(
            f"/api/v1/jobs/{job.id}/segments/0", json={"corrected_text": "fixed"}
        )
        assert response.status_code == 404

    def test_returns_422_when_job_not_succeeded(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUBMITTED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.patch(
            f"/api/v1/jobs/{job.id}/segments/0", json={"corrected_text": "fixed"}
        )
        assert response.status_code == 422

    def test_returns_404_for_out_of_range_index(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [{"speaker": "0", "text": "hi", "start_time": 0, "end_time": 1}]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.patch(
            f"/api/v1/jobs/{job.id}/segments/5", json={"corrected_text": "fixed"}
        )
        assert response.status_code == 404

    def test_stores_correction_and_returns_updated_job(self, client, as_caller, mocker):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "confidence": 0.9,
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            response = client.patch(
                f"/api/v1/jobs/{job.id}/segments/0",
                json={"corrected_text": "the slow brown fox"},
            )
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        body = response.json()
        assert body["dialogue_entries"][0]["corrected_text"] == "the slow brown fox"
        assert body["dialogue_entries"][0]["text"] == "the quick brown fox"
        assert body["accuracy"]["has_corrections"] is True
        mock_session.commit.assert_called_once()

    def test_rejects_empty_correction(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [{"speaker": "0", "text": "hi", "start_time": 0, "end_time": 1}]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.patch(f"/api/v1/jobs/{job.id}/segments/0", json={"corrected_text": ""})
        assert response.status_code == 422


def _words_payload(*texts: str) -> list[dict]:
    return [
        {"text": t, "start_time": float(i), "end_time": float(i) + 1, "confidence": 0.9}
        for i, t in enumerate(texts)
    ]


class TestCorrectWordRange:
    def _patch_session(self, client, mocker):
        from transcription_svc.database.engine import get_session

        mock_session = MagicMock()
        client.app.dependency_overrides[get_session] = lambda: mock_session
        return mock_session

    def test_returns_404_for_unknown_job(self, client, as_caller, mocker):
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=None)
        response = client.patch(
            f"/api/v1/jobs/{uuid.uuid4()}/segments/0/words",
            json={"start_word_index": 0, "end_word_index": 0, "corrected_text": "fixed"},
        )
        assert response.status_code == 404

    def test_returns_404_for_other_callers_job(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.uuid4()
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0,
                "end_time": 1,
                "words": _words_payload("the", "quick", "brown", "fox"),
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.patch(
            f"/api/v1/jobs/{job.id}/segments/0/words",
            json={"start_word_index": 0, "end_word_index": 0, "corrected_text": "fixed"},
        )
        assert response.status_code == 404

    def test_returns_422_when_job_not_succeeded(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUBMITTED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.patch(
            f"/api/v1/jobs/{job.id}/segments/0/words",
            json={"start_word_index": 0, "end_word_index": 0, "corrected_text": "fixed"},
        )
        assert response.status_code == 422

    def test_returns_404_for_out_of_range_index(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [{"speaker": "0", "text": "hi", "start_time": 0, "end_time": 1}]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.patch(
            f"/api/v1/jobs/{job.id}/segments/5/words",
            json={"start_word_index": 0, "end_word_index": 0, "corrected_text": "fixed"},
        )
        assert response.status_code == 404

    def test_returns_422_when_segment_has_no_words(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {"speaker": "0", "text": "the quick brown fox", "start_time": 0, "end_time": 1}
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.patch(
            f"/api/v1/jobs/{job.id}/segments/0/words",
            json={"start_word_index": 0, "end_word_index": 0, "corrected_text": "fixed"},
        )
        assert response.status_code == 422

    def test_returns_422_for_invalid_range(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0,
                "end_time": 1,
                "words": _words_payload("the", "quick", "brown", "fox"),
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.patch(
            f"/api/v1/jobs/{job.id}/segments/0/words",
            json={"start_word_index": 2, "end_word_index": 1, "corrected_text": "fixed"},
        )
        assert response.status_code == 422

        response = client.patch(
            f"/api/v1/jobs/{job.id}/segments/0/words",
            json={"start_word_index": 0, "end_word_index": 10, "corrected_text": "fixed"},
        )
        assert response.status_code == 422

    def test_returns_422_when_whole_segment_already_corrected(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0,
                "end_time": 1,
                "corrected_text": "a different sentence entirely",
                "words": _words_payload("the", "quick", "brown", "fox"),
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.patch(
            f"/api/v1/jobs/{job.id}/segments/0/words",
            json={"start_word_index": 0, "end_word_index": 0, "corrected_text": "fixed"},
        )
        assert response.status_code == 422

    def test_stores_word_range_correction_and_preserves_other_words(
        self, client, as_caller, mocker
    ):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "confidence": 0.9,
                "words": _words_payload("the", "quick", "brown", "fox"),
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            response = client.patch(
                f"/api/v1/jobs/{job.id}/segments/0/words",
                json={"start_word_index": 1, "end_word_index": 1, "corrected_text": "slow"},
            )
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        body = response.json()
        entry = body["dialogue_entries"][0]
        assert entry["corrected_text"] is None
        assert entry["word_corrections"] == [
            {"start_word_index": 1, "end_word_index": 1, "text": "slow"}
        ]
        assert entry["words"] is not None  # untouched per-word data still present
        assert len(entry["correction_history"]) == 1
        assert entry["correction_history"][0]["kind"] == "word_range"
        assert entry["correction_history"][0]["previous_text"] == "the quick brown fox"
        assert entry["correction_history"][0]["new_text"] == "the slow brown fox"
        # The concise phrase-only diff — what a clerk actually wants to see
        # in a history list, as opposed to replaying the whole segment.
        assert entry["correction_history"][0]["previous_phrase"] == "quick"
        assert entry["correction_history"][0]["new_phrase"] == "slow"
        mock_session.commit.assert_called_once()

    def test_new_range_supersedes_overlapping_existing_correction(self, client, as_caller, mocker):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "words": _words_payload("the", "quick", "brown", "fox"),
                "word_corrections": [
                    {"start_word_index": 1, "end_word_index": 2, "text": "very slow"}
                ],
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            response = client.patch(
                f"/api/v1/jobs/{job.id}/segments/0/words",
                json={"start_word_index": 2, "end_word_index": 2, "corrected_text": "grey"},
            )
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        entry = response.json()["dialogue_entries"][0]
        assert entry["word_corrections"] == [
            {"start_word_index": 2, "end_word_index": 2, "text": "grey"}
        ]
        mock_session.commit.assert_called_once()

    def test_re_editing_the_same_range_logs_the_prior_correction_as_previous_phrase(
        self, client, as_caller, mocker
    ):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "words": _words_payload("the", "quick", "brown", "fox"),
                "word_corrections": [{"start_word_index": 1, "end_word_index": 1, "text": "slow"}],
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            response = client.patch(
                f"/api/v1/jobs/{job.id}/segments/0/words",
                json={"start_word_index": 1, "end_word_index": 1, "corrected_text": "sluggish"},
            )
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        history = response.json()["dialogue_entries"][0]["correction_history"]
        # The previous phrase should reflect the existing correction
        # ("slow"), not the original word ("quick").
        assert history[0]["previous_phrase"] == "slow"
        assert history[0]["new_phrase"] == "sluggish"
        mock_session.commit.assert_called_once()


class TestRollbackSegment:
    def _patch_session(self, client, mocker):
        from transcription_svc.database.engine import get_session

        mock_session = MagicMock()
        client.app.dependency_overrides[get_session] = lambda: mock_session
        return mock_session

    def test_returns_404_for_unknown_job(self, client, as_caller, mocker):
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=None)
        response = client.post(f"/api/v1/jobs/{uuid.uuid4()}/segments/0/rollback")
        assert response.status_code == 404

    def test_returns_404_for_other_callers_job(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.uuid4()
        job.dialogue_entries = [{"speaker": "0", "text": "hi", "start_time": 0, "end_time": 1}]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.post(f"/api/v1/jobs/{job.id}/segments/0/rollback")
        assert response.status_code == 404

    def test_returns_422_for_uncorrected_segment(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {"speaker": "0", "text": "the quick brown fox", "start_time": 0, "end_time": 1}
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.post(f"/api/v1/jobs/{job.id}/segments/0/rollback")
        assert response.status_code == 422

    def test_rolls_back_whole_segment_correction(self, client, as_caller, mocker):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "corrected_text": "the slow brown fox",
                "correction_history": [
                    {
                        "timestamp": "2026-01-01T00:00:00+00:00",
                        "kind": "segment",
                        "previous_text": "the quick brown fox",
                        "new_text": "the slow brown fox",
                    }
                ],
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            response = client.post(f"/api/v1/jobs/{job.id}/segments/0/rollback")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        entry = response.json()["dialogue_entries"][0]
        assert entry["corrected_text"] is None
        assert entry["word_corrections"] is None
        assert len(entry["correction_history"]) == 2
        assert entry["correction_history"][1]["kind"] == "rollback"
        assert entry["correction_history"][1]["previous_text"] == "the slow brown fox"
        assert entry["correction_history"][1]["new_text"] == "the quick brown fox"
        mock_session.commit.assert_called_once()

    def test_rolls_back_word_range_correction(self, client, as_caller, mocker):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "words": _words_payload("the", "quick", "brown", "fox"),
                "word_corrections": [{"start_word_index": 1, "end_word_index": 1, "text": "slow"}],
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            response = client.post(f"/api/v1/jobs/{job.id}/segments/0/rollback")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        entry = response.json()["dialogue_entries"][0]
        assert entry["corrected_text"] is None
        assert entry["word_corrections"] is None
        assert entry["correction_history"][0]["kind"] == "rollback"
        assert entry["correction_history"][0]["previous_text"] == "the slow brown fox"
        assert entry["correction_history"][0]["new_text"] == "the quick brown fox"
        mock_session.commit.assert_called_once()


class TestRollbackToHistoryEntry:
    def _patch_session(self, client, mocker):
        from transcription_svc.database.engine import get_session

        mock_session = MagicMock()
        client.app.dependency_overrides[get_session] = lambda: mock_session
        return mock_session

    def test_returns_404_for_unknown_job(self, client, as_caller, mocker):
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=None)
        response = client.post(f"/api/v1/jobs/{uuid.uuid4()}/segments/0/history/0/rollback")
        assert response.status_code == 404

    def test_returns_404_for_other_callers_job(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.uuid4()
        job.dialogue_entries = [{"speaker": "0", "text": "hi", "start_time": 0, "end_time": 1}]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.post(f"/api/v1/jobs/{job.id}/segments/0/history/0/rollback")
        assert response.status_code == 404

    def test_returns_404_for_out_of_range_history_index(self, client, as_caller, mocker):
        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0,
                "end_time": 1,
                "corrected_text": "the slow brown fox",
                "correction_history": [
                    {
                        "timestamp": "2026-01-01T00:00:00+00:00",
                        "kind": "segment",
                        "previous_text": "the quick brown fox",
                        "new_text": "the slow brown fox",
                    }
                ],
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        response = client.post(f"/api/v1/jobs/{job.id}/segments/0/history/5/rollback")
        assert response.status_code == 404

    def test_rolls_back_to_a_specific_history_entry(self, client, as_caller, mocker):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "corrected_text": "the slowest brown fox",
                "correction_history": [
                    {
                        "timestamp": "2026-01-01T00:00:00+00:00",
                        "kind": "segment",
                        "previous_text": "the quick brown fox",
                        "new_text": "the slow brown fox",
                    },
                    {
                        "timestamp": "2026-01-01T00:01:00+00:00",
                        "kind": "segment",
                        "previous_text": "the slow brown fox",
                        "new_text": "the slowest brown fox",
                    },
                ],
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            # Roll back to the state immediately before the second edit —
            # i.e. restore its previous_text, "the slow brown fox".
            response = client.post(f"/api/v1/jobs/{job.id}/segments/0/history/1/rollback")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        entry = response.json()["dialogue_entries"][0]
        assert entry["corrected_text"] == "the slow brown fox"
        assert entry["word_corrections"] is None
        assert len(entry["correction_history"]) == 3
        assert entry["correction_history"][2]["kind"] == "rollback"
        assert entry["correction_history"][2]["previous_text"] == "the slowest brown fox"
        assert entry["correction_history"][2]["new_text"] == "the slow brown fox"
        mock_session.commit.assert_called_once()

    def test_rollback_to_original_clears_corrected_text(self, client, as_caller, mocker):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "corrected_text": "the slow brown fox",
                "correction_history": [
                    {
                        "timestamp": "2026-01-01T00:00:00+00:00",
                        "kind": "segment",
                        "previous_text": "the quick brown fox",
                        "new_text": "the slow brown fox",
                    }
                ],
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            response = client.post(f"/api/v1/jobs/{job.id}/segments/0/history/0/rollback")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        entry = response.json()["dialogue_entries"][0]
        assert entry["corrected_text"] is None
        mock_session.commit.assert_called_once()

    def test_surgically_reverts_a_word_range_entry_to_the_original_word(
        self, client, as_caller, mocker
    ):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "words": _words_payload("the", "quick", "brown", "fox"),
                "word_corrections": [{"start_word_index": 1, "end_word_index": 1, "text": "slow"}],
                "correction_history": [
                    {
                        "timestamp": "2026-01-01T00:00:00+00:00",
                        "kind": "word_range",
                        "previous_text": "the quick brown fox",
                        "new_text": "the slow brown fox",
                        "start_word_index": 1,
                        "end_word_index": 1,
                        "previous_phrase": "quick",
                        "new_phrase": "slow",
                    }
                ],
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            response = client.post(f"/api/v1/jobs/{job.id}/segments/0/history/0/rollback")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        entry = response.json()["dialogue_entries"][0]
        # Reverting to the original word removes the correction entirely
        # rather than keeping a no-op WordCorrection whose text just
        # duplicates the original word.
        assert entry["word_corrections"] is None
        assert entry["corrected_text"] is None
        # Other untouched words' rendering data must survive intact.
        assert entry["words"] is not None
        new_history = entry["correction_history"][1]
        assert new_history["kind"] == "rollback"
        assert new_history["start_word_index"] == 1
        assert new_history["end_word_index"] == 1
        assert new_history["previous_phrase"] == "slow"
        assert new_history["new_phrase"] == "quick"
        mock_session.commit.assert_called_once()

    def test_surgically_reverts_a_re_edited_range_to_the_prior_correction(
        self, client, as_caller, mocker
    ):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "words": _words_payload("the", "quick", "brown", "fox"),
                "word_corrections": [
                    {"start_word_index": 1, "end_word_index": 1, "text": "sluggish"}
                ],
                "correction_history": [
                    {
                        "timestamp": "2026-01-01T00:00:00+00:00",
                        "kind": "word_range",
                        "previous_text": "the quick brown fox",
                        "new_text": "the slow brown fox",
                        "start_word_index": 1,
                        "end_word_index": 1,
                        "previous_phrase": "quick",
                        "new_phrase": "slow",
                    },
                    {
                        "timestamp": "2026-01-01T00:01:00+00:00",
                        "kind": "word_range",
                        "previous_text": "the slow brown fox",
                        "new_text": "the sluggish brown fox",
                        "start_word_index": 1,
                        "end_word_index": 1,
                        "previous_phrase": "slow",
                        "new_phrase": "sluggish",
                    },
                ],
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            # Roll back to before the SECOND edit — should restore "slow"
            # (the first correction), not the original word "quick".
            response = client.post(f"/api/v1/jobs/{job.id}/segments/0/history/1/rollback")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        entry = response.json()["dialogue_entries"][0]
        assert entry["word_corrections"] == [
            {"start_word_index": 1, "end_word_index": 1, "text": "slow"}
        ]
        new_history = entry["correction_history"][2]
        assert new_history["previous_phrase"] == "sluggish"
        assert new_history["new_phrase"] == "slow"
        mock_session.commit.assert_called_once()

    def test_falls_back_to_flat_rollback_when_range_was_since_overridden(
        self, client, as_caller, mocker
    ):
        from transcription_svc.database.engine import get_session

        job = _make_job(status=JobStatus.SUCCEEDED)
        job.caller_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        job.dialogue_entries = [
            {
                "speaker": "0",
                "text": "the quick brown fox",
                "start_time": 0.0,
                "end_time": 1.0,
                "words": _words_payload("the", "quick", "brown", "fox"),
                # A whole-segment freeform edit has since overridden
                # everything — the original word_range correction no longer
                # has a clean word-position correspondence to revert to.
                "corrected_text": "a completely different sentence",
                "correction_history": [
                    {
                        "timestamp": "2026-01-01T00:00:00+00:00",
                        "kind": "word_range",
                        "previous_text": "the quick brown fox",
                        "new_text": "the slow brown fox",
                        "start_word_index": 1,
                        "end_word_index": 1,
                        "previous_phrase": "quick",
                        "new_phrase": "slow",
                    },
                    {
                        "timestamp": "2026-01-01T00:01:00+00:00",
                        "kind": "segment",
                        "previous_text": "the slow brown fox",
                        "new_text": "a completely different sentence",
                    },
                ],
            }
        ]
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        mock_session = self._patch_session(client, mocker)

        try:
            response = client.post(f"/api/v1/jobs/{job.id}/segments/0/history/0/rollback")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 200
        entry = response.json()["dialogue_entries"][0]
        # Falls back to the flat whole-segment snapshot rather than
        # attempting (and failing) a surgical per-word revert. Restoring
        # back to the original text clears corrected_text entirely, since
        # entry.text already reads "the quick brown fox".
        assert entry["corrected_text"] is None
        assert entry["word_corrections"] is None
        mock_session.commit.assert_called_once()


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
