"""Telemetry for the recording API (DIAAT-205), built on hmcts-otel.

``configure_telemetry()`` is called by ``create_app()``. Everything is configured
from the environment:

* ``APPLICATIONINSIGHTS_CONNECTION_STRING`` — export to App Insights (unset: stdout only)
* ``OTEL_SERVICE_NAME`` — defaults to ``batch-audio-transcription-api``
* ``SENTRY_DSN`` — error triage in Sentry (hardened; tracing stays in OpenTelemetry)
"""

from __future__ import annotations

import os
import re

from hmcts_otel import TelemetrySettings, default_redactor, default_schema, setup_telemetry

from transcription_svc.config.settings import get_settings

DEFAULT_SERVICE_NAME = "batch-audio-transcription-api"

# Immigration and Asylum Chamber appeal references, e.g. PA/50123/2024. Uploaded file
# names carry the same reference with underscores (PA_50123_2024.mp3), and the
# frontend derives the job's case reference from the file name.
# "_" is a word character, so \b would miss references next to other text in file
# names (hearing_PA_50123_2024_part1.mp3): use lookarounds. Case-insensitive.
APPEAL_REFERENCE = r"(?i)(?<![A-Za-z0-9])[A-Z]{2}[/_]\d{5}[/_]\d{4}(?![0-9])"

# Journey types (DIAAT-276). Query one identifier in App Insights:
#   customEvents | where customDimensions["hmcts.journey.id"] == "<id>"
JOURNEY_UPLOAD = "recording.upload"  # id: the UUID in the uploaded blob's name
JOURNEY_JOB = "recording.job"  # id: TranscriptionJob.id; parent: the upload's id

_UPLOAD_ID = re.compile(r"^uploads/[^/]+/([0-9a-fA-F-]{36})-")


def upload_id_from_blob(blob_name: str | None) -> str | None:
    """The upload's journey ID (the UUID in ``uploads/{user}/{uuid}-{stem}.wav``)."""
    match = _UPLOAD_ID.match(blob_name or "")
    return match.group(1) if match else None


def batch_job_id_from_url(batch_job_url: str | None) -> str | None:
    """Azure Speech batch job ID, related to our job ID as ``hmcts.dependency.ref``."""
    return batch_job_url.rstrip("/").rsplit("/", 1)[-1] if batch_job_url else None


def _register_schema() -> None:
    default_schema.attribute(
        "audio.format",
        allowed_values={"mp3", "wav", "mp4", "m4a", "ogg", "flac"},
        description="Extension of the uploaded audio file.",
    )


def configure_telemetry() -> TelemetrySettings:
    """Set up logging, tracing, metrics and Sentry for this process. Idempotent."""
    # Checked against the redactor itself, so the rules are present whenever telemetry
    # is configured, whatever happened to the library state before.
    if "appeal_reference" not in {rule.name for rule in default_redactor.rules}:
        default_redactor.add_rule("appeal_reference", APPEAL_REFERENCE)
    if default_schema.get_attribute("audio.format") is None:
        _register_schema()
    settings = get_settings()
    overrides: dict[str, str] = {
        "service_version": settings.GIT_SHA,
        "environment": settings.ENVIRONMENT,
    }
    if not os.environ.get("OTEL_SERVICE_NAME"):
        overrides["service_name"] = DEFAULT_SERVICE_NAME
    return setup_telemetry(TelemetrySettings(**overrides))
