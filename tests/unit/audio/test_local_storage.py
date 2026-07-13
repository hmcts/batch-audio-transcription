"""Unit tests for the dev-only local audio storage backend."""

import pytest

from transcription_svc.audio import local_storage
from transcription_svc.config.settings import get_settings


@pytest.fixture(autouse=True)
def local_storage_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCAL_AUDIO_STORAGE_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


class TestSaveAndRead:
    def test_round_trips_bytes(self):
        local_storage.save(b"fake-audio-bytes", "uploads/caller-1/file.wav")
        assert local_storage.read("uploads/caller-1/file.wav") == b"fake-audio-bytes"

    def test_creates_nested_directories(self, local_storage_dir):
        local_storage.save(b"x", "a/b/c/file.mp3")
        assert (local_storage_dir / "a" / "b" / "c" / "file.mp3").exists()

    def test_rejects_path_traversal_on_save(self):
        with pytest.raises(ValueError, match="invalid blob_name"):
            local_storage.save(b"x", "../../etc/passwd")

    def test_rejects_path_traversal_on_read(self):
        with pytest.raises(ValueError, match="invalid blob_name"):
            local_storage.read("../../etc/passwd")

    def test_read_missing_file_raises(self):
        with pytest.raises(FileNotFoundError):
            local_storage.read("does/not/exist.wav")


class TestValidateBlobName:
    @pytest.mark.parametrize(
        "blob_name",
        [
            "../../etc/passwd",
            "uploads/../../../etc/passwd",
            "uploads/./file.wav",
            "uploads//file.wav",
            "uploads/caller$1/file.wav",
            "uploads/caller 1/file.wav",
        ],
    )
    def test_rejects_unsafe_blob_names(self, blob_name):
        with pytest.raises(ValueError, match="invalid blob_name"):
            local_storage.save(b"x", blob_name)

    @pytest.mark.parametrize(
        "blob_name",
        [
            "file.wav",
            "uploads/caller-1/file.wav",
            "uploads/00000000-0000-0000-0000-000000000001/hearing.mp3",
        ],
    )
    def test_accepts_safe_blob_names(self, blob_name):
        local_storage.save(b"x", blob_name)
        assert local_storage.read(blob_name) == b"x"


class TestBuildUrl:
    def test_builds_url_from_base(self, monkeypatch):
        monkeypatch.setenv("LOCAL_AUDIO_BASE_URL", "https://abc123.ngrok-free.app")
        get_settings.cache_clear()

        url = local_storage.build_url("uploads/caller-1/file.wav")

        assert url == "https://abc123.ngrok-free.app/api/v1/local-audio/uploads/caller-1/file.wav"

    def test_raises_when_base_url_not_configured(self, monkeypatch):
        monkeypatch.delenv("LOCAL_AUDIO_BASE_URL", raising=False)
        get_settings.cache_clear()

        with pytest.raises(ValueError, match="LOCAL_AUDIO_BASE_URL"):
            local_storage.build_url("uploads/caller-1/file.wav")
