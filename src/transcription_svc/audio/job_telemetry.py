"""Transcription-job lifecycle telemetry (DIAAT-281).

Builds on the job journey of DIAAT-276 (``recording.job``, id = job id, parent = the
upload id) and adds what makes waiting, stuck, retried and failed jobs visible.

Timings, from timestamps the service already has (plus processing_started_datetime):

* queue wait: job created (upload complete, row inserted) -> Azure Speech started
  processing it (its ``lastActionDateTime`` on the first poll that sees Running). It
  includes our submission call (also the ``speech_submission`` stage duration, and
  ``job.queued``'s duration_ms) and the time Azure held the job as NotStarted.
* processing: Azure processing started -> Azure finished (its ``lastActionDateTime``
  when it reports Succeeded or Failed; the poll's time if missing).
* end to end: job created -> transcript available (or the job's terminal failure).
  What remains after queue wait and processing is our poll lag and result handling.

There is no message queue: work is driven by polling the transcription_job table, so
the queue gauges are computed from that table (see ``JobStateGauges``).
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from hmcts_otel import conventions as c
from hmcts_otel import get_meter, journey, record_event
from opentelemetry.metrics import CallbackOptions, Meter, Observation
from sqlmodel import Session

from transcription_svc.config.settings import get_settings
from transcription_svc.database.interface import (
    JobStateCounts,
    claim_stuck_jobs,
    count_job_states,
)
from transcription_svc.database.models import JobStatus
from transcription_svc.telemetry import (
    ATTR_JOB_STATE,
    ATTR_PROCESSING_MS,
    ATTR_QUEUE_WAIT_MS,
    ATTR_RETRY_ATTEMPT,
    ATTR_RETRY_OPERATION,
    EVENT_JOB_FINISHED,
    EVENT_JOB_RETRIED,
    EVENT_JOB_RUNNING,
    EVENT_JOB_STUCK,
    JOURNEY_JOB,
    upload_id_from_blob,
)

logger = logging.getLogger(__name__)

METRIC_JOB_DURATION = "transcription.job.duration"
METRIC_JOBS_FINISHED = "transcription.jobs.finished"
METRIC_JOB_RETRIES = "transcription.job.retries"
METRIC_JOBS_WAITING = "transcription.jobs.waiting"
METRIC_JOBS_RUNNING = "transcription.jobs.running"
METRIC_QUEUE_DEPTH = "transcription.jobs.queue_depth"
METRIC_OLDEST_WAITING_AGE = "transcription.jobs.oldest_waiting_age"
METRIC_JOBS_STUCK = "transcription.jobs.stuck"

# Values of the "phase" attribute on transcription.job.duration.
PHASE_QUEUE_WAIT = "queue_wait"
PHASE_PROCESSING = "processing"
PHASE_END_TO_END = "end_to_end"


# Timestamps -----------------------------------------------------------------------------


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def seconds_between(start: datetime | None, end: datetime | None) -> float | None:
    """Seconds from start to end, never negative (clock skew); None if either is unknown."""
    if start is None or end is None:
        return None
    return max(0.0, (_utc(end) - _utc(start)).total_seconds())


def azure_last_action(status_data: Mapping[str, Any]) -> datetime | None:
    """Azure's ``lastActionDateTime``: when the job entered its current status."""
    value = status_data.get("lastActionDateTime")
    if not isinstance(value, str):
        return None
    try:
        return _utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        return None


def processing_started_at(
    status_data: Mapping[str, Any], created_at: datetime | None, now: datetime | None = None
) -> datetime:
    """When Azure started processing, from the first status response that says Running.

    Azure's own timestamp, kept within [job created, now]; the poll's time without it.
    """
    now = now or datetime.now(UTC)
    started = azure_last_action(status_data)
    if started is None or started > now:
        return now
    if created_at is not None and started < _utc(created_at):
        return _utc(created_at)
    return started


# Instruments ----------------------------------------------------------------------------

_instruments: dict[str, tuple[Meter, Any]] = {}
_instruments_lock = threading.Lock()


def _instrument(kind: str, name: str, **kwargs: Any) -> Any:
    """One instrument per name for the current meter provider (tests replace it)."""
    meter = get_meter()
    with _instruments_lock:
        existing = _instruments.get(name)
        if existing is not None and existing[0] is meter:
            return existing[1]
        factory = {"histogram": meter.create_histogram, "counter": meter.create_counter}[kind]
        created = factory(name, **kwargs)
        _instruments[name] = (meter, created)
        return created


def _record_duration(phase: str, seconds: float | None, outcome: str | None = None) -> None:
    if seconds is None:
        return
    attributes = {"phase": phase}
    if outcome is not None:
        attributes[c.OUTCOME] = outcome
    try:
        _instrument(
            "histogram",
            METRIC_JOB_DURATION,
            unit="s",
            description="Transcription job queue wait, processing and end-to-end time",
        ).record(seconds, attributes)
    except Exception as exc:  # telemetry must never break the job
        logger.warning("Could not record job duration (%s)", type(exc).__name__)


# Lifecycle events -----------------------------------------------------------------------


def record_processing_started(
    attributes: Mapping[str, object], created_at: datetime | None, started_at: datetime
) -> None:
    """speech.job_running, with the queue wait as its duration."""
    queue_wait = seconds_between(created_at, started_at)
    record_event(
        EVENT_JOB_RUNNING,
        attributes,
        duration_ms=queue_wait * 1000.0 if queue_wait is not None else None,
    )
    _record_duration(PHASE_QUEUE_WAIT, queue_wait)


def record_job_finished(
    outcome: str,
    error_code: str | None = None,
    *,
    created_at: datetime | None,
    processing_started: datetime | None = None,
    processing_ended: datetime | None = None,
) -> None:
    """The job's terminal state: job.finished, its durations and the finished-jobs count.

    duration_ms is the end-to-end time. Queue wait and processing are attached when the
    processing start is known (not for jobs that never reached Azure, or that Azure
    finished between two polls).
    """
    now = datetime.now(UTC)
    attributes: dict[str, object] = {c.OUTCOME: outcome}
    if error_code:
        attributes[c.ERROR_CODE] = error_code
    queue_wait = seconds_between(created_at, processing_started)
    processing = seconds_between(processing_started, processing_ended or now)
    if processing_started is not None and queue_wait is not None and processing is not None:
        attributes[ATTR_QUEUE_WAIT_MS] = queue_wait * 1000.0
        attributes[ATTR_PROCESSING_MS] = processing * 1000.0
    end_to_end = seconds_between(created_at, now)
    record_event(
        EVENT_JOB_FINISHED,
        attributes,
        duration_ms=end_to_end * 1000.0 if end_to_end is not None else None,
    )
    if processing_started is not None:
        _record_duration(PHASE_PROCESSING, processing, outcome)
    _record_duration(PHASE_END_TO_END, end_to_end, outcome)
    try:
        _instrument(
            "counter", METRIC_JOBS_FINISHED, unit="{job}", description="Jobs that finished"
        ).add(1, {c.OUTCOME: outcome, c.ERROR_CODE: error_code or "none"})
    except Exception as exc:
        logger.warning("Could not count finished job (%s)", type(exc).__name__)


# Retries --------------------------------------------------------------------------------


def failure_code(exc: BaseException, component: str) -> str:
    """A controlled code for a failed call: never the exception's message."""
    last = getattr(exc, "last_attempt", None)  # tenacity.RetryError: use the cause
    if last is not None and getattr(last, "failed", False):
        cause = last.exception()
        if cause is not None:
            exc = cause
    if isinstance(exc, httpx.HTTPStatusError):
        return f"{component}.http_{exc.response.status_code}"
    if isinstance(exc, httpx.TimeoutException):
        return f"{component}.timeout"
    if isinstance(exc, httpx.ConnectError):
        return f"{component}.connect_error"
    return f"unhandled.{type(exc).__name__}"[:64]


def record_retry(operation: str, attempt: int, error_code: str) -> None:
    """A call for the current job failed and is about to be retried."""
    record_event(
        EVENT_JOB_RETRIED,
        {ATTR_RETRY_OPERATION: operation, ATTR_RETRY_ATTEMPT: attempt, c.ERROR_CODE: error_code},
    )
    try:
        _instrument("counter", METRIC_JOB_RETRIES, unit="{retry}", description="Retried calls").add(
            1, {ATTR_RETRY_OPERATION: operation, c.ERROR_CODE: error_code}
        )
    except Exception as exc:
        logger.warning("Could not count retry (%s)", type(exc).__name__)


_SPEECH_OPERATIONS = {
    "submit_batch_job": "speech.submit",
    "get_batch_job_status": "speech.status",
    "get_batch_results": "speech.results",
    "delete_batch_job": "speech.delete",
}


def record_speech_retry(retry_state: Any) -> None:
    """tenacity ``before_sleep`` hook for the Azure Speech client's retry policy."""
    try:
        operation = _SPEECH_OPERATIONS.get(getattr(retry_state.fn, "__name__", ""))
        exc = retry_state.outcome.exception() if retry_state.outcome is not None else None
        if operation is None or exc is None:
            return
        record_retry(operation, retry_state.attempt_number, failure_code(exc, "speech"))
    except Exception as exc:  # never change the retry behaviour
        logger.warning("Could not record retry (%s)", type(exc).__name__)


# Stuck jobs -----------------------------------------------------------------------------


def _cutoffs(now: datetime) -> tuple[datetime, datetime]:
    settings = get_settings()
    return (
        now - timedelta(seconds=settings.JOB_STUCK_WAITING_SECONDS),
        now - timedelta(seconds=settings.JOB_STUCK_RUNNING_SECONDS),
    )


def report_stuck_jobs(session: Session, now: datetime | None = None) -> int:
    """Emit job.stuck for each job newly past its threshold. Observation only.

    Each job is claimed (stuck_reported_at) before it is reported, so the event is
    emitted once per job however many replicas poll. Returns the number reported.
    """
    now = now or datetime.now(UTC)
    waiting_cutoff, running_cutoff = _cutoffs(now)
    stuck = claim_stuck_jobs(session, waiting_cutoff=waiting_cutoff, running_cutoff=running_cutoff)
    for job in stuck:
        running = JobStatus(job.status) == JobStatus.RUNNING
        state = "running" if running else "waiting"
        since = job.processing_started_datetime if running else None
        age = seconds_between(since or job.created_datetime, now)
        attributes: dict[str, object] = {ATTR_JOB_STATE: state}
        if job.batch_job_id:
            attributes[c.DEPENDENCY_REF] = job.batch_job_id
        with journey(JOURNEY_JOB, str(job.id), parent_id=upload_id_from_blob(job.audio_blob_path)):
            record_event(
                EVENT_JOB_STUCK,
                attributes,
                duration_ms=age * 1000.0 if age is not None else None,
            )
        logger.warning("Job %s is stuck: %s for %.0f s", job.id, state, age or 0.0)
    return len(stuck)


# Queue gauges ---------------------------------------------------------------------------


class JobStateGauges:
    """Observable gauges of the job "queue", computed from the transcription_job table.

    Multiple replicas: every replica runs the same query and so reports the same
    database-wide value. Dashboards and alerts must aggregate these gauges with max
    (or take any one replica's value), never sum, or the numbers multiply by the
    replica count.

    Cost: one aggregate query, at most once per ``max_age_s``, shared by all five
    gauges (they are observed together on each export, every 60 s by default). A
    database error is logged and that collection is skipped: no values are reported,
    and neither the export nor the app fails. A failure is also cached for
    ``max_age_s`` so a database outage is not queried once per gauge.
    """

    def __init__(
        self,
        session_factory: Callable[[], Session],
        *,
        max_age_s: float = 15.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._session_factory = session_factory
        self._max_age_s = max_age_s
        self._clock = clock
        self._lock = threading.Lock()
        self._fetched_at: float | None = None
        self._counts: JobStateCounts | None = None

    def snapshot(self) -> JobStateCounts | None:
        with self._lock:
            if self._fetched_at is not None and self._clock() - self._fetched_at < self._max_age_s:
                return self._counts
            self._fetched_at = self._clock()
            try:
                waiting_cutoff, running_cutoff = _cutoffs(datetime.now(UTC))
                with self._session_factory() as session:
                    self._counts = count_job_states(
                        session, waiting_cutoff=waiting_cutoff, running_cutoff=running_cutoff
                    )
            except Exception as exc:
                logger.warning("Job state gauges skipped: query failed (%s)", type(exc).__name__)
                self._counts = None
            return self._counts

    def _observations(self, values: Callable[[JobStateCounts], Iterable[Observation]]):
        def callback(_options: CallbackOptions) -> Iterable[Observation]:
            counts = self.snapshot()
            return list(values(counts)) if counts is not None else []

        return callback

    def register(self, meter: Meter) -> None:
        meter.create_observable_gauge(
            METRIC_JOBS_WAITING,
            callbacks=[self._observations(lambda n: [Observation(n.waiting)])],
            unit="{job}",
            description="Jobs not yet processed by Azure Speech (pending or submitted)",
        )
        meter.create_observable_gauge(
            METRIC_JOBS_RUNNING,
            callbacks=[self._observations(lambda n: [Observation(n.running)])],
            unit="{job}",
            description="Jobs being processed by Azure Speech",
        )
        meter.create_observable_gauge(
            METRIC_QUEUE_DEPTH,
            callbacks=[self._observations(lambda n: [Observation(n.waiting + n.running)])],
            unit="{job}",
            description="Unfinished jobs: waiting plus running",
        )
        meter.create_observable_gauge(
            METRIC_OLDEST_WAITING_AGE,
            callbacks=[self._observations(self._oldest_waiting_age)],
            unit="s",
            description="Age of the oldest waiting job (0 when none are waiting)",
        )
        meter.create_observable_gauge(
            METRIC_JOBS_STUCK,
            callbacks=[
                self._observations(
                    lambda n: [
                        Observation(n.stuck_waiting, {ATTR_JOB_STATE: "waiting"}),
                        Observation(n.stuck_running, {ATTR_JOB_STATE: "running"}),
                    ]
                )
            ],
            unit="{job}",
            description="Jobs waiting or running longer than their stuck threshold",
        )

    @staticmethod
    def _oldest_waiting_age(counts: JobStateCounts) -> list[Observation]:
        age = seconds_between(counts.oldest_waiting_created, datetime.now(UTC))
        return [Observation(age or 0.0)]


_registered: list[Meter] = []


def register_job_gauges(session_factory: Callable[[], Session] | None = None) -> bool:
    """Register the job-state gauges on the current meter provider, once. True if new."""
    meter = get_meter()
    if any(existing is meter for existing in _registered):
        return False
    if session_factory is None:
        from transcription_svc.database.engine import get_engine

        def session_factory() -> Session:
            return Session(get_engine())

    JobStateGauges(session_factory).register(meter)
    _registered.append(meter)
    return True
