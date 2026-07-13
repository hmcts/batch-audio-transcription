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
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from transcription_svc.config.settings import get_settings

# blob_name may contain "/" (e.g. "uploads/<caller>/<file>") but each segment
# is restricted to a safe character set with no "." or ".." segments, so path
# traversal is rejected outright rather than relying solely on resolving the
# path and checking containment after the fact.
_SAFE_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def _validate_blob_name(blob_name: str) -> None:
    segments = blob_name.split("/")
    for segment in segments:
        if segment in ("", ".", "..") or not _SAFE_SEGMENT_RE.match(segment):
            raise ValueError(f"invalid blob_name: {blob_name!r}")


def _resolve_within_root(root: Path, blob_name: str) -> Path:
    _validate_blob_name(blob_name)
    target = (root / PurePosixPath(blob_name)).resolve()
    # Defense in depth: confirm the resolved path still lives under root.
    if target != root and root not in target.parents:
        raise ValueError(f"blob_name escapes local storage root: {blob_name!r}")
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
    # blob_name segments are already restricted to a safe character set (see
    # _validate_blob_name), but quote defensively in case that ever changes.
    return f"{base.rstrip('/')}/api/v1/local-audio/{quote(blob_name, safe='/')}"
