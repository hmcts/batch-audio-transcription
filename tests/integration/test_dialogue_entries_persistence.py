"""Integration test: DIAAT-232's `alternatives` field round-trips through a
real Postgres JSONB column, not just through in-memory model_dump/reconstruct.

Requires a reachable Postgres (see docker-compose.yml's `postgres` service,
or point DATABASE_CONNECTION_STRING at any scratch database) — skipped
automatically otherwise, matching this suite's existing convention of unit
tests covering the JSONB round-trip in isolation for CI, with this file as
the higher-fidelity check run manually against a real database.
"""

from __future__ import annotations

import uuid

import pytest
import sqlalchemy
from sqlmodel import Session, SQLModel, create_engine

from transcription_svc.config.settings import get_settings
from transcription_svc.database.interface import get_job_by_id, save_job_results
from transcription_svc.database.models import (
    BatchJobStatus,
    Caller,
    DialogueEntry,
    NBestCandidate,
    PhraseAlternatives,
    TranscriptionJob,
    WordInfo,
)


def _db_available(url: str) -> bool:
    try:
        engine = create_engine(url)
        with engine.connect():
            return True
    except Exception:
        return False
    finally:
        engine.dispose()


_DB_URL = get_settings().DATABASE_CONNECTION_STRING
pytestmark = pytest.mark.skipif(
    not _db_available(_DB_URL),
    reason="No reachable Postgres at DATABASE_CONNECTION_STRING; skipping live-DB round-trip test",
)


@pytest.fixture
def session():
    engine = create_engine(_DB_URL)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s
    # Leave no trace between runs against a shared scratch database.
    with engine.begin() as conn:
        conn.execute(sqlalchemy.text("DELETE FROM transcription_job"))
        conn.execute(sqlalchemy.text("DELETE FROM caller"))
    engine.dispose()


def _make_caller(session: Session) -> Caller:
    caller = Caller(
        name=f"itest-{uuid.uuid4()}",
        hashed_key="hashed",
        webhook_secret="secret",
    )
    session.add(caller)
    session.commit()
    session.refresh(caller)
    return caller


def test_full_nbest_array_survives_a_real_jsonb_round_trip(session):
    caller = _make_caller(session)
    job = TranscriptionJob(
        caller_id=caller.id,
        audio_url="https://example.com/audio.wav",
        dialogue_entries=[],
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    job_id = job.id

    entries = [
        DialogueEntry(
            speaker="Speaker 0",
            text="Hello world.",
            start_time=0.76,
            end_time=2.08,
            confidence=0.5643338,
            words=[
                WordInfo(text="hello", start_time=0.76, end_time=1.52, confidence=0.95),
                WordInfo(text="world", start_time=1.52, end_time=2.08, confidence=0.6),
            ],
            alternatives=[
                PhraseAlternatives(
                    start_word_index=0,
                    end_word_index=1,
                    candidates=[
                        NBestCandidate(
                            text="Hello world.", confidence=0.5643338, lexical="hello world"
                        ),
                        NBestCandidate(
                            text="helloworld", confidence=0.1769063, lexical="helloworld"
                        ),
                        NBestCandidate(
                            text="hello worlds", confidence=0.49964225, lexical="hello worlds"
                        ),
                    ],
                )
            ],
        )
    ]

    save_job_results(session, job_id, entries, BatchJobStatus.SUCCEEDED)

    # Fresh session-less fetch: a brand new read from Postgres, not the ORM
    # instance already held in memory, so this genuinely exercises the JSONB
    # column rather than an identity-mapped Python object.
    session.expunge_all()
    reloaded = get_job_by_id(session, job_id)

    assert reloaded is not None
    raw_entry = reloaded.dialogue_entries[0]
    assert "alternatives" in raw_entry
    rebuilt = DialogueEntry(**raw_entry)

    assert rebuilt.alternatives is not None
    group = rebuilt.alternatives[0]
    assert group.start_word_index == 0
    assert group.end_word_index == 1
    assert [c.text for c in group.candidates] == [
        "Hello world.",
        "helloworld",
        "hello worlds",
    ]
    assert group.candidates[2].confidence == pytest.approx(0.49964225)
    # The already-existing top-choice fields are untouched by this change.
    assert rebuilt.text == "Hello world."
    assert rebuilt.confidence == pytest.approx(0.5643338)
    assert [w.text for w in rebuilt.words] == ["hello", "world"]
