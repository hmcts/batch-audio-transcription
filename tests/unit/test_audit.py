"""DIAAT-286: the audit writer (transcription_svc.audit).

* one INSERT per call, every row stamped with one timestamp and the request ID;
* fail-open: a failed write never raises, is logged by exception type only and emits
  audit.write_failed carrying only the action (no actor, job or content);
* audited(): success, failed (with the HTTP status) or nothing (skip), and the
  exception still propagates.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from hmcts_otel import conventions as c
from hmcts_otel import default_schema, request_id_context
from hmcts_otel.testing import capture_telemetry
from sqlalchemy.exc import OperationalError

from transcription_svc import audit
from transcription_svc.audit import AuditRecord, audited, denied, write_audit
from transcription_svc.telemetry import (
    ATTR_AUDIT_ACTION,
    AUDIT_ACTIONS,
    EVENT_AUDIT_WRITE_FAILED,
    configure_telemetry,
)

ACTOR = uuid.UUID("00000000-0000-4000-8000-0000000000c1")
JOB = uuid.UUID("00000000-0000-4000-8000-0000000000a1")
REQUEST_ID = "0123456789abcdef0123456789abcdef"
SECRET_IN_ERROR = "the appellant said something confidential"


@pytest.fixture
def tel():
    with capture_telemetry() as capture:
        configure_telemetry()
        yield capture


def test_rows_carry_the_record_the_time_and_the_request_id(audit_capture):
    before = datetime.now(UTC)
    with request_id_context(REQUEST_ID):
        write_audit(AuditRecord("transcript.view", "success", ACTOR, JOB))

    ((row,),) = audit_capture.inserts
    assert isinstance(row.pop("id"), uuid.UUID)
    timestamp = row.pop("timestamp")
    assert timestamp.tzinfo is not None and before <= timestamp <= datetime.now(UTC)
    assert row == {
        "actor_id": ACTOR,
        "action": "transcript.view",
        "outcome": "success",
        "object_type": "job",
        "object_id": JOB,
        "request_id": REQUEST_ID,
        "detail": None,
    }


def test_several_records_are_one_insert(audit_capture):
    other = uuid.uuid4()
    write_audit(
        AuditRecord("transcript.view", "success", ACTOR, JOB),
        denied("transcript.view", ACTOR, other, "ownership_assertion_failed"),
    )

    (rows,) = audit_capture.inserts
    assert [(r["object_id"], r["outcome"]) for r in rows] == [(JOB, "success"), (other, "denied")]
    assert rows[0]["timestamp"] == rows[1]["timestamp"]
    assert rows[1]["detail"] == {"reason": "ownership_assertion_failed"}


def test_nothing_to_write_is_no_insert(audit_capture):
    write_audit()
    assert audit_capture.inserts == []


def test_without_a_request_the_request_id_is_null(audit_capture):
    write_audit(AuditRecord("job.delete", "success", ACTOR, JOB))
    assert audit_capture.rows[0]["request_id"] is None


def test_a_failed_write_never_raises_and_reports_only_the_action(tel, monkeypatch, caplog):
    error = OperationalError("INSERT ...", {"detail": SECRET_IN_ERROR}, Exception(SECRET_IN_ERROR))

    def broken(rows):
        raise error

    monkeypatch.setattr(audit, "_insert", broken)

    with caplog.at_level(logging.ERROR, logger="transcription_svc.audit"):
        write_audit(AuditRecord("audio.export", "success", ACTOR, JOB))  # does not raise

    (event,) = tel.events(EVENT_AUDIT_WRITE_FAILED)
    assert event[ATTR_AUDIT_ACTION] == "audio.export"
    assert event[c.ERROR_CODE] == "audit.write_failed"
    (record,) = [r for r in caplog.records if r.name == "transcription_svc.audit"]
    assert record.getMessage() == "Audit record could not be written (OperationalError)"
    assert record.exc_info is None  # no traceback: it would quote the row
    tel.assert_no_prohibited_content(str(ACTOR), str(JOB), SECRET_IN_ERROR)


def test_a_failure_to_report_the_failure_is_swallowed_too(monkeypatch):
    monkeypatch.setattr(audit, "_insert", lambda rows: 1 / 0)
    monkeypatch.setattr(audit, "record_event", lambda *a, **k: 1 / 0)

    write_audit(AuditRecord("job.delete", "success", ACTOR, JOB))  # does not raise


def test_the_failure_event_is_registered_with_only_the_action_and_code(tel):
    spec = default_schema.get_event(EVENT_AUDIT_WRITE_FAILED)
    assert spec is not None
    assert set(spec.attributes) == {ATTR_AUDIT_ACTION, c.ERROR_CODE}
    assert default_schema.attributes[ATTR_AUDIT_ACTION].allowed_values == set(AUDIT_ACTIONS)


def test_the_real_insert_uses_its_own_session_and_commits(monkeypatch):
    # Undo the capture fixture: exercise _insert itself with a fake session.
    monkeypatch.undo()
    calls = []

    class FakeSession:
        def __init__(self, engine):
            calls.append(("open", engine))

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            calls.append(("close",))

        def execute(self, statement, rows):
            calls.append(("execute", statement.table.name, rows))

        def commit(self):
            calls.append(("commit",))

    monkeypatch.setattr(audit, "Session", FakeSession)
    monkeypatch.setattr(audit, "get_engine", lambda: "engine")

    audit._insert([{"a": 1}, {"a": 2}])

    assert calls == [
        ("open", "engine"),
        ("execute", "audit_log", [{"a": 1}, {"a": 2}]),
        ("commit",),
        ("close",),
    ]


# audited() ---------------------------------------------------------------------------------


def test_audited_block_is_a_success(audit_capture):
    with audited("job.submit", ACTOR) as scope:
        scope.object_id = JOB
        scope.detail["replayed"] = True

    (row,) = audit_capture.rows
    assert (row["action"], row["outcome"], row["object_id"]) == ("job.submit", "success", JOB)
    assert row["detail"] == {"replayed": True}


def test_audited_http_error_is_failed_with_its_status_and_propagates(audit_capture):
    with pytest.raises(HTTPException), audited("job.delete", ACTOR, JOB):
        raise HTTPException(status_code=502, detail="Failed to delete the audio file")

    (row,) = audit_capture.rows
    assert (row["outcome"], row["detail"]) == ("failed", {"reason": "http_502"})


def test_audited_unexpected_error_is_failed_and_propagates(audit_capture):
    with pytest.raises(RuntimeError), audited("transcript.view", ACTOR, JOB) as scope:
        scope.detail["partial"] = False
        raise RuntimeError(SECRET_IN_ERROR)

    (row,) = audit_capture.rows
    assert (row["outcome"], row["detail"]) == ("failed", {"partial": False, "reason": "error"})


def test_skipped_block_writes_nothing_even_when_it_raises(audit_capture):
    with audited("transcript.view", ACTOR, JOB) as scope:
        scope.skip()
    with pytest.raises(HTTPException), audited("job.submit", ACTOR) as scope:
        scope.skip()
        raise HTTPException(status_code=422)

    assert audit_capture.inserts == []


@pytest.mark.parametrize(
    ("resource_type", "action", "expected"),
    [
        ("transcript", "read", "transcript.view"),
        ("transcript", "write", "transcript.edit"),
        ("audio", "read", "audio.export"),
        ("job", "delete", "job.delete"),
        ("upload", "submit", "job.submit"),
    ],
)
def test_security_violation_maps_to_the_audited_action(resource_type, action, expected):
    assert audit.action_for_violation(resource_type, action) == expected
    assert expected in AUDIT_ACTIONS
