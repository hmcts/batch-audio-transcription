"""Local-disk audio storage — dev-only alternative to Azure Blob Storage.

Lets the full upload -> Speech Batch submission pipeline be exercised
locally without Storage Blob Data Contributor rights on the developer's own
Azure identity, by writing audio to disk and serving it back over HTTP
(typically tunnelled, e.g. via ngrok, so Azure Speech Batch — a cloud
service that cannot reach localhost — can fetch it).

Only active when AUDIO_STORAGE_BACKEND=local, which must never be set in a
deployed environment (see config/settings.py).
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath

from transcription_svc.config.settings import get_settings


def _resolve_within_root(root: Path, blob_name: str) -> Path:
    # blob_name may contain "/" (e.g. "uploads/<caller>/<file>"); resolve and
    # confirm the result still lives under root, rejecting any "../" path
    # traversal smuggled in via a crafted filename.
    target = (root / PurePosixPath(blob_name)).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"blob_name escapes local storage root: {blob_name}")
    return target


def _storage_root() -> Path:
    root = Path(get_settings().LOCAL_AUDIO_STORAGE_DIR).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def save(content: bytes, blob_name: str) -> Path:
    root = _storage_root()
    target = _resolve_within_root(root, blob_name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return target


def read(blob_name: str) -> bytes:
    root = _storage_root()
    target = _resolve_within_root(root, blob_name)
    return target.read_bytes()


def build_url(blob_name: str) -> str:
    base = get_settings().LOCAL_AUDIO_BASE_URL
    if not base:
        raise ValueError("LOCAL_AUDIO_BASE_URL is not configured")
    return f"{base.rstrip('/')}/api/v1/local-audio/{blob_name}"
