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
from hmcts_otel import conventions as c

from transcription_svc.config.settings import get_settings

DEFAULT_SERVICE_NAME = "batch-audio-transcription-api"

# Immigration and Asylum Chamber appeal references, e.g. PA/50123/2024. Uploaded file
# names carry the same reference with underscores (PA_50123_2024.mp3), and the
# frontend derives the job's case reference from the file name.
# "_" is a word character, so \b would miss references next to other text in file
# names (hearing_PA_50123_2024_part1.mp3): use lookarounds. Case-insensitive.
APPEAL_REFERENCE = r"(?i)(?<![A-Za-z0-9])[A-Z]{2}[/_]\d{5}[/_]\d{4}(?![0-9])"

# DIAAT-280: uploaded blobs are named uploads/{user id}/{upload id}-{sanitised original
# file name}.wav (a product decision), and the original file name is usually a case
# reference. The Azure SDK exports the blob URL: its HTTP logging policy logs
# "Request URL: '<blob url>'" at INFO, and its client spans (azure_sdk instrumentation,
# on by default in the Azure Monitor distro) carry url.full, of which hmcts-otel strips
# only the query. Our own blob logs (azure_utils) print the blob name too. Remove
# whatever follows "/{uuid}/{uuid}-", keeping the IDs so the upload stays traceable.
# Fixed-width lookbehinds, for the plain path and the percent-encoded one
# (uploads%2F{user id}%2F{upload id}-..., either case). The name has no length cap
# (file names are not truncated, so a cap would leak the tail of a long one): it
# stops only at a path separator, query, quote or space. A name that is already just
# the marker is skipped, but a partly redacted one (e.g.
# "[REDACTED]_Smith_v_Home_Office.wav" after the appeal_reference rule) is still
# removed whole. Registered before appeal_reference for the same reason.
_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
_NAME_END = r"[\s/?#\"'<>\\]"
UPLOAD_FILE_NAME = (
    rf"(?:(?<=/{_UUID}/{_UUID}-)|(?<=%2[Ff]{_UUID}%2[Ff]{_UUID}-))"
    rf"(?!\[REDACTED\](?:{_NAME_END}|$))[^\s/?#\"'<>\\]+"
)

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


# DIAAT-280: emitted once per validation failure, before the stage's upload.failed.
EVENT_UPLOAD_VALIDATION_FAILED = "upload.validation_failed"
UPLOAD_METADATA = ("upload.file_count", "file.size_bytes", "audio.format", "audio.format_category")

# DIAAT-281: job lifecycle. Each event carries the job journey (hmcts.journey.id = job
# id, parent = upload id). States: job.created -> job.queued (Azure accepted) ->
# speech.job_running (processing started) -> job.finished (completed or failed).
EVENT_JOB_CREATED = "job.created"
EVENT_JOB_QUEUED = "job.queued"
EVENT_JOB_RUNNING = "speech.job_running"
EVENT_JOB_FAILED_IN_SPEECH = "speech.job_failed"
EVENT_TRANSCRIPT_AVAILABLE = "transcript.available"
EVENT_JOB_FINISHED = "job.finished"
EVENT_JOB_RETRIED = "job.retried"
EVENT_JOB_POLL_FAILED = "job.poll_failed"
EVENT_JOB_STUCK = "job.stuck"
EVENT_WEBHOOK_DELIVERY_FAILED = "webhook.delivery_failed"

ATTR_JOB_STATE = "job.state"
ATTR_QUEUE_WAIT_MS = "job.queue_wait_ms"
ATTR_PROCESSING_MS = "job.processing_ms"
ATTR_RETRY_OPERATION = "job.retry.operation"
ATTR_RETRY_ATTEMPT = "job.retry.attempt"

JOB_STATES = ("waiting", "running")
RETRY_OPERATIONS = (
    "speech.submit",
    "speech.status",
    "speech.results",
    "speech.delete",
    "webhook.deliver",
)


def _register_schema() -> None:
    default_schema.attribute(
        "audio.format",
        allowed_values={"mp3", "wav", "mp4", "m4a", "ogg", "flac"},
        description="Extension of the uploaded audio file.",
    )
    default_schema.attribute(
        "audio.format_category",
        allowed_values={"audio", "video"},
        description="Whether the upload was an audio or a video container (.mp4).",
    )
    default_schema.attribute(
        "audio.duration_seconds",
        type=float,
        description="Duration of the normalised (16 kHz mono WAV) audio, in seconds.",
    )
    default_schema.attribute(
        "file.size_bytes", type=int, description="Size of the uploaded file in bytes."
    )
    default_schema.attribute(
        "upload.file_count",
        type=int,
        description="Number of files uploaded for the hearing (X-Hearing-File-Count).",
    )
    default_schema.event(
        EVENT_UPLOAD_VALIDATION_FAILED,
        description="An uploaded file was rejected; hmcts.error.code says why.",
        attributes=(c.STAGE, c.ERROR_CODE, *UPLOAD_METADATA),
    )
    _register_job_schema()


def _register_job_schema() -> None:
    default_schema.attribute(
        ATTR_JOB_STATE,
        allowed_values=JOB_STATES,
        description="waiting: not yet processed by Azure Speech; running: being processed.",
    )
    default_schema.attribute(
        ATTR_QUEUE_WAIT_MS,
        type=float,
        description="Queue wait: job created to Azure Speech processing started, in ms.",
    )
    default_schema.attribute(
        ATTR_PROCESSING_MS,
        type=float,
        description="Processing: Azure Speech processing started to finished, in ms.",
    )
    default_schema.attribute(
        ATTR_RETRY_OPERATION,
        allowed_values=RETRY_OPERATIONS,
        description="The call being retried.",
    )
    default_schema.attribute(
        ATTR_RETRY_ATTEMPT,
        type=int,
        description="Number of the attempt that failed (1 on the first retry).",
    )
    job_events = (
        (EVENT_JOB_CREATED, (), "Job row created: the upload is complete and the job exists."),
        (EVENT_JOB_QUEUED, (), "Azure Speech accepted the job; duration_ms: created to accepted."),
        (EVENT_JOB_RUNNING, (), "Azure Speech started processing; duration_ms: the queue wait."),
        (EVENT_JOB_FAILED_IN_SPEECH, (), "Azure Speech reported the job as failed."),
        (EVENT_TRANSCRIPT_AVAILABLE, (), "The transcript is saved and can be read."),
        (
            EVENT_JOB_FINISHED,
            (ATTR_QUEUE_WAIT_MS, ATTR_PROCESSING_MS),
            "Terminal state. hmcts.outcome success, or failure/error with hmcts.error.code; "
            "duration_ms: end to end, job created to finished.",
        ),
        (
            EVENT_JOB_RETRIED,
            (ATTR_RETRY_OPERATION, ATTR_RETRY_ATTEMPT),
            "A call for the job failed and is retried; hmcts.error.code says why.",
        ),
        (
            EVENT_JOB_POLL_FAILED,
            (),
            "Polling the job failed; it stays unfinished and is polled again.",
        ),
        (
            EVENT_JOB_STUCK,
            (ATTR_JOB_STATE,),
            "The job has waited or run longer than its threshold. Emitted once per job; "
            "duration_ms: time in that state so far.",
        ),
        (
            EVENT_WEBHOOK_DELIVERY_FAILED,
            (),
            "The caller's webhook could not be delivered after all attempts.",
        ),
    )
    for name, attributes, description in job_events:
        default_schema.event(name, description=description, attributes=attributes)


def configure_telemetry() -> TelemetrySettings:
    """Set up logging, tracing, metrics and Sentry for this process. Idempotent."""
    # Checked against the redactor itself, so the rules are present whenever telemetry
    # is configured, whatever happened to the library state before.
    # upload_file_name first: it removes the whole file name, including any case
    # reference at its start (appeal_reference alone would leave the rest).
    if "upload_file_name" not in {rule.name for rule in default_redactor.rules}:
        default_redactor.add_rule("upload_file_name", UPLOAD_FILE_NAME)
    if "appeal_reference" not in {rule.name for rule in default_redactor.rules}:
        default_redactor.add_rule("appeal_reference", APPEAL_REFERENCE)
    if default_schema.get_event(EVENT_UPLOAD_VALIDATION_FAILED) is None:
        _register_schema()
    settings = get_settings()
    overrides: dict[str, str] = {
        "service_version": settings.GIT_SHA,
        "environment": settings.ENVIRONMENT,
    }
    if not os.environ.get("OTEL_SERVICE_NAME"):
        overrides["service_name"] = DEFAULT_SERVICE_NAME
    return setup_telemetry(TelemetrySettings(**overrides))
