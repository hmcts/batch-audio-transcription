"""Telemetry for the recording API (DIAAT-205), built on hmcts-otel.

``configure_telemetry()`` is called by ``create_app()``. Everything is configured
from the environment:

* ``APPLICATIONINSIGHTS_CONNECTION_STRING`` — export to App Insights (unset: stdout only)
* ``OTEL_SERVICE_NAME`` — defaults to ``batch-audio-transcription-api``
* ``SENTRY_DSN`` — error triage in Sentry (hardened; tracing stays in OpenTelemetry)
"""

from __future__ import annotations

import os

from hmcts_otel import TelemetrySettings, default_redactor, setup_telemetry

from transcription_svc.config.settings import get_settings

DEFAULT_SERVICE_NAME = "batch-audio-transcription-api"

# Immigration and Asylum Chamber appeal references, e.g. PA/50123/2024. Uploaded file
# names carry the same reference with underscores (PA_50123_2024.mp3), and the
# frontend derives the job's case reference from the file name.
# "_" is a word character, so \b would miss references next to other text in file
# names (hearing_PA_50123_2024_part1.mp3): use lookarounds. Case-insensitive.
APPEAL_REFERENCE = r"(?i)(?<![A-Za-z0-9])[A-Z]{2}[/_]\d{5}[/_]\d{4}(?![0-9])"

_rules_added = False


def configure_telemetry() -> TelemetrySettings:
    """Set up logging, tracing, metrics and Sentry for this process. Idempotent."""
    global _rules_added  # noqa: PLW0603
    if not _rules_added:
        default_redactor.add_rule("appeal_reference", APPEAL_REFERENCE)
        _rules_added = True
    settings = get_settings()
    overrides: dict[str, str] = {
        "service_version": settings.GIT_SHA,
        "environment": settings.ENVIRONMENT,
    }
    if not os.environ.get("OTEL_SERVICE_NAME"):
        overrides["service_name"] = DEFAULT_SERVICE_NAME
    return setup_telemetry(TelemetrySettings(**overrides))
