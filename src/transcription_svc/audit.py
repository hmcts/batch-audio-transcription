"""Audit records of sensitive actions on jobs (DIAAT-286).

Who (``actor_id``, the internal ``User.id``; never an email or a name) did what
(``action``) to which job (``object_type`` / ``object_id``), when (``timestamp``),
whether it worked (``outcome``: success, denied or failed) and in which request
(``request_id``, the ``hmcts.request.id`` that also tags the request's telemetry and
any ``security.ownership_violation`` event). ``detail`` holds only controlled values
(a reason code, an HTTP status); never transcript text, file names or case references.

Audited actions (the vocabulary is ``telemetry.AUDIT_ACTIONS``):

* ``transcript.view``: a transcript was returned by the job detail (GET /jobs/{id});
* ``audio.export``: the job's audio was streamed back (the only audio egress);
* ``job.delete``: a job and its audio were deleted;
* ``job.submit``: a transcription job was submitted;
* ``transcript.edit``: recorded only when refused (corrections and baselines).

A refusal (outcome ``denied``) is recorded wherever DIAAT-285 records an ownership
violation (``blocked`` and ``detected``), including the job list's ``detected``
assertion. A failure after authorisation is ``failed``.

The job list (GET /jobs) is NOT recorded as a view. The dashboard polls it every 5 s
while any job is in flight, so one row per returned transcript per poll would bury
the real sensitive events and grow the table without bound. OPEN SECURITY QUESTION:
should a list view count as a view? It matters because GET /jobs returns the full
transcripts (dialogue entries) of every job on the page, which the dashboard does not
need: removing them from the list response (a data-exposure fix) would make the
question moot.

Decision OD7: audit records are stored with the record, in the application database
(table ``audit_log``), not in monitoring telemetry.

Writing is fail-open: if the write fails the request carries on, the failure is logged
(exception type only) and ``audit.write_failed`` is emitted (the action only). Whether
a sensitive action should instead be refused when it cannot be audited (fail-closed)
is a security decision that has not been taken.

Append-only: ``write_audit`` is the only code that touches the table, and it only
inserts. Nothing in the application updates or deletes audit rows.

Access and retention (AC3): PENDING the security and data decision. There is no
retention or purge mechanism, and no API to read audit records: access is direct
database access (the same access as the transcripts themselves). Do not add a purge
or a read API without that decision.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import HTTPException
from hmcts_otel import conventions as c
from hmcts_otel import get_request_id, is_valid_request_id, record_event
from sqlalchemy import insert
from sqlmodel import Session

from transcription_svc.database.engine import get_engine
from transcription_svc.database.models import AuditLog
from transcription_svc.telemetry import (
    ATTR_AUDIT_ACTION,
    EVENT_AUDIT_WRITE_FAILED,
    AuditAction,
    AuditObjectType,
    AuditOutcome,
    SecurityAction,
    SecurityResourceType,
)

logger = logging.getLogger(__name__)

# Why a request was refused. not_owner: the job (or upload) belongs to another user;
# legacy_job: a job from before per-user ownership, which only administrators may
# reach; ownership_assertion_failed: authorisation let it through but the
# post-authorisation assertion caught it (DIAAT-285 "detected", an authorisation defect).
DenialReason = Literal["not_owner", "legacy_job", "ownership_assertion_failed"]

# The DIAAT-285 security event's (resource type, action) as the audited action.
_ACTION_FOR_VIOLATION: dict[tuple[str, str], AuditAction] = {
    ("transcript", "read"): "transcript.view",
    ("transcript", "write"): "transcript.edit",
    ("audio", "read"): "audio.export",
    ("job", "delete"): "job.delete",
    ("job", "read"): "transcript.view",
    ("upload", "submit"): "job.submit",
}


def action_for_violation(
    resource_type: SecurityResourceType, action: SecurityAction
) -> AuditAction:
    """The audited action that a DIAAT-285 ownership violation was an attempt at."""
    return _ACTION_FOR_VIOLATION[(resource_type, action)]


@dataclass(frozen=True)
class AuditRecord:
    """One audit row, before it is stamped with the time and the request ID."""

    action: AuditAction
    outcome: AuditOutcome
    actor_id: UUID
    object_id: UUID | None
    object_type: AuditObjectType = "job"
    detail: dict[str, object] | None = None


def denied(
    action: AuditAction,
    actor_id: UUID,
    object_id: UUID | None,
    reason: DenialReason,
    object_type: AuditObjectType = "job",
) -> AuditRecord:
    return AuditRecord(action, "denied", actor_id, object_id, object_type, {"reason": reason})


def _request_id() -> str | None:
    request_id = get_request_id()
    return request_id if is_valid_request_id(request_id) else None


def write_audit(*records: AuditRecord) -> None:
    """Insert the records in one statement and one transaction. Never raises.

    Its own session, so a refusal or a failure is recorded even when the request's
    transaction is rolled back. All rows share one timestamp and the request ID.
    """
    if not records:
        return
    try:
        timestamp = datetime.now(UTC)
        request_id = _request_id()
        rows = [
            {
                "id": uuid4(),
                "timestamp": timestamp,
                "actor_id": record.actor_id,
                "action": record.action,
                "outcome": record.outcome,
                "object_type": record.object_type,
                "object_id": record.object_id,
                "request_id": request_id,
                "detail": record.detail,
            }
            for record in records
        ]
        _insert(rows)
    except Exception as exc:  # an audit failure must never break the user's request
        _write_failed(records[0].action, exc)


def _insert(rows: list[dict[str, object]]) -> None:
    """One INSERT (of every row) in its own transaction. The only database write."""
    with Session(get_engine()) as session:
        session.execute(insert(AuditLog), rows)
        session.commit()


def _write_failed(action: AuditAction, exc: BaseException) -> None:
    try:
        # The exception type only: a database error message can quote the row.
        logger.error("Audit record could not be written (%s)", type(exc).__name__)
        record_event(
            EVENT_AUDIT_WRITE_FAILED,
            {ATTR_AUDIT_ACTION: action, c.ERROR_CODE: "audit.write_failed"},
        )
    except Exception:  # noqa: BLE001, S110 - reporting the failure must not raise either
        pass


@dataclass
class AuditScope:
    """The audited block's result: set ``object_id``/``detail``, or ``skip()`` it."""

    object_id: UUID | None = None
    detail: dict[str, object] = field(default_factory=dict)
    skipped: bool = False

    def skip(self) -> None:
        """No record from this scope: nothing sensitive happened (e.g. the job has no
        transcript yet), or the block wrote its own record (a refusal)."""
        self.skipped = True


@contextmanager
def audited(
    action: AuditAction,
    actor_id: UUID,
    object_id: UUID | None = None,
    object_type: AuditObjectType = "job",
) -> Iterator[AuditScope]:
    """Record the block, which runs after authorisation, as one audit row.

    success if it completes; failed if it raises (detail.reason: http_<status> for an
    HTTPException, else "error"), and the exception propagates unchanged. Nothing if
    the block called ``skip()``.
    """
    scope = AuditScope(object_id=object_id)
    try:
        yield scope
    except HTTPException as exc:
        _failed(scope, action, actor_id, object_type, f"http_{exc.status_code}")
        raise
    except Exception:
        _failed(scope, action, actor_id, object_type, "error")
        raise
    if not scope.skipped:
        write_audit(
            AuditRecord(
                action, "success", actor_id, scope.object_id, object_type, scope.detail or None
            )
        )


def _failed(
    scope: AuditScope,
    action: AuditAction,
    actor_id: UUID,
    object_type: AuditObjectType,
    reason: str,
) -> None:
    if scope.skipped:  # the block recorded its own outcome (e.g. a refusal)
        return
    detail = {**scope.detail, "reason": reason}
    write_audit(AuditRecord(action, "failed", actor_id, scope.object_id, object_type, detail))
