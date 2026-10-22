"""Telemetry for the recording API (DIAAT-205), built on hmcts-otel.

``configure_telemetry()`` is called by ``create_app()``. Everything is configured
from the environment:

* ``APPLICATIONINSIGHTS_CONNECTION_STRING`` — export to App Insights (unset: stdout only)
* ``OTEL_SERVICE_NAME`` — defaults to ``batch-audio-transcription-api``
* ``SENTRY_DSN`` — error triage in Sentry (hardened; tracing stays in OpenTelemetry)
"""

from __future__ import annotations

import logging
import os
import re
from typing import Literal

from hmcts_otel import (
    Journey,
    TelemetrySettings,
    default_redactor,
    default_schema,
    record_event,
    setup_telemetry,
)
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

# DIAAT-282: Azure Speech as an external dependency.
# Where a failure came from: our code or database, the job queue, or Azure Speech.
ATTR_FAILURE_SOURCE = "hmcts.failure.source"
FAILURE_SOURCES = ("application", "queue", "dependency")
# Azure's own error code (properties.error.code of a failed job, or the "code" of an
# HTTP error body), e.g. InvalidData. Never Azure's free-text message.
ATTR_SPEECH_ERROR_CODE = "speech.error_code"
ATTR_HTTP_STATUS = "http.response.status_code"
ATTR_RETRY_AFTER_S = "speech.retry_after_s"
# Configuration reference: what the job was sent to and with.
ATTR_SPEECH_REGION = "speech.region"
ATTR_SPEECH_LOCALE = "speech.locale"
ATTR_SPEECH_API_VERSION = "speech.api_version"
ATTR_SPEECH_MODEL_REF = "speech.model_ref"
ATTR_SPEECH_DIARIZATION = "speech.diarization"

SPEECH_FAILURE_ATTRIBUTES = (
    ATTR_FAILURE_SOURCE,
    ATTR_SPEECH_ERROR_CODE,
    ATTR_HTTP_STATUS,
    ATTR_RETRY_AFTER_S,
)
SPEECH_CONFIG_ATTRIBUTES = (
    ATTR_SPEECH_REGION,
    ATTR_SPEECH_LOCALE,
    ATTR_SPEECH_API_VERSION,
    ATTR_SPEECH_MODEL_REF,
    ATTR_SPEECH_DIARIZATION,
)

# DIAAT-283: after Azure Speech succeeds. Each step is a stage of the job journey
# (<stage>.started / .completed / .failed, duration on hmcts.stage.duration), nested
# in result_processing, which stays the umbrella for the whole attempt:
#   results_retrieval -> transcript_postprocessing -> transcript_persistence
#   -> transcript.available -> job.finished (-> webhook.delivered / delivery_failed)
STAGE_RESULTS_RETRIEVAL = "results_retrieval"
STAGE_POSTPROCESSING = "transcript_postprocessing"
STAGE_PERSISTENCE = "transcript_persistence"
POST_SPEECH_STAGES = (STAGE_RESULTS_RETRIEVAL, STAGE_POSTPROCESSING, STAGE_PERSISTENCE)
# A speaker-processing step failed and the transcript was saved with the previous
# step's output (process_speakers never raises).
EVENT_POSTPROCESS_DEGRADED = "transcript.postprocess_degraded"
# A database or blob write after Azure Speech finished failed.
EVENT_STORAGE_FAILED = "job.storage_failed"
EVENT_WEBHOOK_DELIVERED = "webhook.delivered"

ATTR_SEGMENT_COUNT = "transcript.segment_count"
ATTR_SPEAKER_COUNT = "transcript.speaker_count"
ATTR_POSTPROCESS_STEP = "transcript.postprocess_step"
POSTPROCESS_STEPS = ("speaker_grouping", "speaker_normalisation", "speaker_labelling")
ATTR_STORAGE_OPERATION = "storage.operation"
STORAGE_OPERATIONS = (
    "transcript.save",
    "job.mark_failed",
    "job.mark_needs_cleanup",
    "blob.mark_failed",
)
ATTR_WEBHOOK_NOTIFICATION = "webhook.notification"
WEBHOOK_NOTIFICATIONS = ("succeeded", "failed")

# DIAAT-277: service health. A background checker probes each critical dependency;
# the shared contract (identical in courtstranscribe) is the event and attributes
# below, plus the service.dependency.up gauge and service.dependency.check.duration
# histogram (see dependency_health.py).
EVENT_DEPENDENCY_HEALTH_CHANGED = "dependency.health_changed"
ATTR_DEPENDENCY_NAME = "dependency.name"
ATTR_DEPENDENCY_STATE = "dependency.state"
DEPENDENCY_NAMES = ("database", "storage", "speech")
DEPENDENCY_STATES = ("up", "down")
DEPENDENCY_ERROR_CODES = (
    "dependency.timeout",
    "dependency.auth_failed",
    "dependency.unreachable",
    "dependency.error",
)

# DIAAT-285: security events. Someone reached, or tried to reach, a job, transcript,
# audio or upload that is not theirs. Routed to Security by the ownership-violation
# alert. Never carries user IDs, emails, blob or file names, or content: investigators
# correlate on hmcts.request.id (and the target's journey ID) in App Insights.
#   blocked:  the authorisation check refused it (the caller got the usual 404/422);
#   detected: authorisation let it through but the post-authorisation ownership
#             assertion caught it (an authorisation defect; the caller still got 404);
#   test:     a controlled test of the alert route (dev only, see
#             SECURITY_ALERT_TEST_TRIGGER_ENABLED).
EVENT_OWNERSHIP_VIOLATION = "security.ownership_violation"
ATTR_SECURITY_RESOURCE_TYPE = "security.resource_type"
ATTR_SECURITY_ACTION = "security.action"
ATTR_SECURITY_OUTCOME = "security.outcome"
SecurityResourceType = Literal["job", "transcript", "audio", "upload"]
SecurityAction = Literal["read", "write", "delete", "submit"]
SecurityOutcome = Literal["blocked", "detected", "test"]
SECURITY_RESOURCE_TYPES = ("job", "transcript", "audio", "upload")
SECURITY_ACTIONS = ("read", "write", "delete", "submit")
SECURITY_OUTCOMES = ("blocked", "detected", "test")

_security_log = logging.getLogger("transcription_svc.security")

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
    _register_dependency_health_schema()
    _register_security_schema()


def _register_security_schema() -> None:
    """DIAAT-285: the ownership-violation security event (types only, never who or what)."""
    default_schema.attribute(
        ATTR_SECURITY_RESOURCE_TYPE,
        allowed_values=SECURITY_RESOURCE_TYPES,
        description="Kind of resource the caller does not own: job, transcript, audio or upload.",
    )
    default_schema.attribute(
        ATTR_SECURITY_ACTION,
        allowed_values=SECURITY_ACTIONS,
        description="What the caller tried to do with it: read, write, delete or submit.",
    )
    default_schema.attribute(
        ATTR_SECURITY_OUTCOME,
        allowed_values=SECURITY_OUTCOMES,
        description="blocked: refused by the authorisation check; detected: let through by "
        "authorisation but caught by the post-authorisation ownership assertion (a defect); "
        "test: a controlled test of the alert route.",
    )
    default_schema.event(
        EVENT_OWNERSHIP_VIOLATION,
        description="A caller reached, or tried to reach, a resource they do not own. "
        "Correlate on hmcts.request.id; hmcts.journey.id is the target job or upload.",
        attributes=(ATTR_SECURITY_RESOURCE_TYPE, ATTR_SECURITY_ACTION, ATTR_SECURITY_OUTCOME),
    )


def record_ownership_violation(
    resource_type: SecurityResourceType,
    action: SecurityAction,
    outcome: SecurityOutcome,
    *,
    journey: Journey | None = None,
) -> None:
    """DIAAT-285: emit ``security.ownership_violation``. The single place that does.

    Only the three enums, plus the request ID and journey that record_event adds (the
    journey given here, e.g. the target job, or the current one). Nothing about who
    the caller or the owner is. ``detected`` is also logged at ERROR (types only), so
    it reaches Sentry: it means an authorisation check let a non-owner through.
    """
    record_event(
        EVENT_OWNERSHIP_VIOLATION,
        {
            ATTR_SECURITY_RESOURCE_TYPE: resource_type,
            ATTR_SECURITY_ACTION: action,
            ATTR_SECURITY_OUTCOME: outcome,
        },
        journey=journey,
    )
    if outcome == "detected":
        _security_log.error(
            "Ownership assertion failed after authorisation: %s %s blocked",
            resource_type,
            action,
        )


def _register_dependency_health_schema() -> None:
    """DIAAT-277: dependency health transitions (never hostnames, URLs or messages)."""
    default_schema.attribute(
        ATTR_DEPENDENCY_NAME,
        allowed_values=DEPENDENCY_NAMES,
        description="A critical dependency: database (PostgreSQL), storage (Azure Blob "
        "Storage) or speech (Azure Speech batch transcription).",
    )
    default_schema.attribute(
        ATTR_DEPENDENCY_STATE,
        allowed_values=DEPENDENCY_STATES,
        description="up: the last health check succeeded; down: it failed or timed out.",
    )
    default_schema.event(
        EVENT_DEPENDENCY_HEALTH_CHANGED,
        description="A dependency went from up to down or back (or was down on its first "
        "check). hmcts.error.code (when down): dependency.timeout, dependency.auth_failed, "
        "dependency.unreachable or dependency.error.",
        attributes=(ATTR_DEPENDENCY_NAME, ATTR_DEPENDENCY_STATE, c.ERROR_CODE),
    )


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
    _register_speech_schema()
    _register_post_speech_attributes()
    job_events = (
        (EVENT_JOB_CREATED, (), "Job row created: the upload is complete and the job exists."),
        (
            EVENT_JOB_QUEUED,
            SPEECH_CONFIG_ATTRIBUTES,
            "Azure Speech accepted the job; duration_ms: created to accepted.",
        ),
        (EVENT_JOB_RUNNING, (), "Azure Speech started processing; duration_ms: the queue wait."),
        (
            EVENT_JOB_FAILED_IN_SPEECH,
            (ATTR_FAILURE_SOURCE, ATTR_SPEECH_ERROR_CODE),
            "Azure Speech reported the job as failed; speech.error_code is Azure's code.",
        ),
        (
            EVENT_TRANSCRIPT_AVAILABLE,
            (ATTR_SEGMENT_COUNT, ATTR_SPEAKER_COUNT),
            "The transcript is saved and can be read. hmcts.dependency.ref: the Azure "
            "Speech job; duration_ms: Azure finished to available (DIAAT-283).",
        ),
        (
            EVENT_JOB_FINISHED,
            (
                ATTR_QUEUE_WAIT_MS,
                ATTR_PROCESSING_MS,
                *SPEECH_FAILURE_ATTRIBUTES,
                *SPEECH_CONFIG_ATTRIBUTES,
            ),
            "Terminal state. hmcts.outcome success, or failure/error with hmcts.error.code "
            "and hmcts.failure.source; duration_ms: end to end, job created to finished.",
        ),
        (
            EVENT_JOB_RETRIED,
            (ATTR_RETRY_OPERATION, ATTR_RETRY_ATTEMPT, *SPEECH_FAILURE_ATTRIBUTES),
            "A call for the job failed and is retried; hmcts.error.code says why.",
        ),
        (
            EVENT_JOB_POLL_FAILED,
            SPEECH_FAILURE_ATTRIBUTES,
            "Polling the job failed; it stays unfinished and is polled again.",
        ),
        (
            EVENT_JOB_STUCK,
            (ATTR_JOB_STATE, ATTR_FAILURE_SOURCE),
            "The job has waited or run longer than its threshold. Emitted once per job; "
            "duration_ms: time in that state so far.",
        ),
        (
            EVENT_WEBHOOK_DELIVERY_FAILED,
            (ATTR_WEBHOOK_NOTIFICATION,),
            "The caller's webhook could not be delivered after all attempts.",
        ),
        (
            EVENT_WEBHOOK_DELIVERED,
            (ATTR_WEBHOOK_NOTIFICATION,),
            "The caller's webhook was delivered (2xx).",
        ),
        (
            EVENT_POSTPROCESS_DEGRADED,
            (ATTR_POSTPROCESS_STEP,),
            "A speaker-processing step failed; the previous step's output is kept.",
        ),
        (
            EVENT_STORAGE_FAILED,
            (ATTR_STORAGE_OPERATION, ATTR_FAILURE_SOURCE),
            "A database or blob write after Azure Speech finished failed; "
            "hmcts.error.code says which kind (storage.db_* or storage.blob_failed).",
        ),
    )
    for name, attributes, description in job_events:
        default_schema.event(name, description=description, attributes=attributes)
    _register_post_speech_stages()


def _register_post_speech_attributes() -> None:
    """DIAAT-283: what the steps after Azure Speech succeeds record."""
    default_schema.attribute(
        ATTR_SEGMENT_COUNT, type=int, description="Number of dialogue entries in the transcript."
    )
    default_schema.attribute(
        ATTR_SPEAKER_COUNT, type=int, description="Number of distinct speakers in the transcript."
    )
    default_schema.attribute(
        ATTR_POSTPROCESS_STEP,
        allowed_values=POSTPROCESS_STEPS,
        description="The speaker-processing step that failed.",
    )
    default_schema.attribute(
        ATTR_STORAGE_OPERATION,
        allowed_values=STORAGE_OPERATIONS,
        description="The database or blob write that failed.",
    )
    default_schema.attribute(
        ATTR_WEBHOOK_NOTIFICATION,
        allowed_values=WEBHOOK_NOTIFICATIONS,
        description="Which result the webhook carried: the job succeeded or failed.",
    )


def _register_post_speech_stages() -> None:
    """DIAAT-283: the stages after Azure Speech succeeds (events made by stage())."""
    purposes = (
        "Downloading the transcript from Azure Speech",
        "Speaker processing",
        "Saving the transcript to the database",
    )
    for name, purpose in zip(POST_SPEECH_STAGES, purposes, strict=True):
        for verb, meaning in (
            ("started", "started"),
            ("completed", "completed; duration_ms: its duration"),
            ("failed", "failed; hmcts.error.code says why, duration_ms: its duration"),
            ("cancelled", "was cancelled"),
        ):
            default_schema.event(f"{name}.{verb}", description=f"{purpose} {meaning}.")


def _register_speech_schema() -> None:
    default_schema.attribute(
        ATTR_FAILURE_SOURCE,
        allowed_values=FAILURE_SOURCES,
        description="Where a failure came from: application (our code or database), queue "
        "(the job was never processed) or dependency (Azure Speech).",
    )
    default_schema.attribute(
        ATTR_SPEECH_ERROR_CODE,
        pattern=r"[A-Za-z][A-Za-z0-9_.]{0,63}",
        description="Azure Speech's own error code, e.g. InvalidData. Never its message.",
    )
    default_schema.attribute(
        ATTR_HTTP_STATUS, type=int, description="HTTP status of the failed Azure Speech call."
    )
    default_schema.attribute(
        ATTR_RETRY_AFTER_S,
        type=float,
        description="Retry-After sent by Azure Speech with a throttled (429) response, in s.",
    )
    default_schema.attribute(
        ATTR_SPEECH_REGION,
        pattern=r"[a-z0-9]{2,32}",
        description="Azure region of the Speech resource, e.g. uksouth.",
    )
    default_schema.attribute(
        ATTR_SPEECH_LOCALE,
        pattern=r"[a-z]{2,3}-[A-Z]{2}",
        description="Locale the job was transcribed in, e.g. en-GB.",
    )
    default_schema.attribute(
        ATTR_SPEECH_API_VERSION,
        pattern=r"v[0-9]{1,2}\.[0-9]{1,2}(-preview(\.[0-9]{1,2})?)?",
        description="Speech to text REST API version, e.g. v3.2.",
    )
    default_schema.attribute(
        ATTR_SPEECH_MODEL_REF,
        pattern=r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        description="ID (GUID) of the Speech model Azure used for the job.",
    )
    default_schema.attribute(
        ATTR_SPEECH_DIARIZATION, type=bool, description="Whether speaker diarization was on."
    )


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
