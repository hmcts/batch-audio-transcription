import os

import pytest

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_CONNECTION_STRING", "postgresql://test:test@localhost:5432/test_db")
os.environ.setdefault("AZURE_SPEECH_KEY", "test-key")
os.environ.setdefault("AZURE_SPEECH_ENDPOINT", "https://test.cognitiveservices.azure.com")
os.environ.setdefault("AZURE_STORAGE_ACCOUNT_NAME", "teststorage")
os.environ.setdefault("AZURE_STORAGE_CONTAINER_NAME", "test-container")
os.environ.setdefault("LOCAL_API_KEY", "test-api-key")


@pytest.fixture(autouse=True)
def reset_settings_cache():
    from transcription_svc.config.settings import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class AuditCapture:
    """The audit inserts a test made: one list of rows per INSERT."""

    def __init__(self) -> None:
        self.inserts: list[list[dict]] = []

    def __call__(self, rows: list[dict]) -> None:
        self.inserts.append(list(rows))

    @property
    def rows(self) -> list[dict]:
        return [row for insert in self.inserts for row in insert]


@pytest.fixture(autouse=True)
def audit_capture(monkeypatch):
    """DIAAT-286: audit rows written during the test, captured instead of inserted.

    Unit tests have no database: without this, every audited request would try to
    connect and fall back to the fail-open path. Tests of the real insert undo this
    patch (or use the integration suite).
    """
    capture = AuditCapture()
    monkeypatch.setattr("transcription_svc.audit._insert", capture)
    return capture
