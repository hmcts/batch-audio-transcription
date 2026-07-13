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

import re
from pathlib import Path
from urllib.parse import quote

from transcription_svc.config.settings import get_settings

# blob_name is a "/"-separated logical id (e.g. "uploads/<caller>/<file>"),
# but each segment is restricted to a safe character set with no "." or ".."
# segments, and the on-disk filename collapses it to a single flat component
# (see _flat_filename) — so there is no hierarchical directory join for a
# crafted blob_name to escape, regardless of its content.
_SAFE_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def _validate_blob_name(blob_name: str) -> None:
    segments = blob_name.split("/")
    for segment in segments:
        if segment in ("", ".", "..") or not _SAFE_SEGMENT_RE.match(segment):
            raise ValueError(f"invalid blob_name: {blob_name!r}")


def _flat_filename(blob_name: str) -> str:
    _validate_blob_name(blob_name)
    return blob_name.replace("/", "__")


def _storage_root() -> Path:
    root = Path(get_settings().LOCAL_AUDIO_STORAGE_DIR).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def save(content: bytes, blob_name: str) -> Path:
    target = _storage_root() / _flat_filename(blob_name)
    target.write_bytes(content)
    return target


def read(blob_name: str) -> bytes:
    target = _storage_root() / _flat_filename(blob_name)
    return target.read_bytes()


def build_url(blob_name: str) -> str:
    base = get_settings().LOCAL_AUDIO_BASE_URL
    if not base:
        raise ValueError("LOCAL_AUDIO_BASE_URL is not configured")
    # blob_name segments are already restricted to a safe character set (see
    # _validate_blob_name), but quote defensively in case that ever changes.
    return f"{base.rstrip('/')}/api/v1/local-audio/{quote(blob_name, safe='/')}"
