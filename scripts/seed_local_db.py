"""Seed the local dev database with a completed transcription job.

Usage (via docker-compose):
    docker-compose --profile seed run --rm seed

Usage (directly, with the API already running):
    DATABASE_CONNECTION_STRING=<dsn> python scripts/seed_local_db.py
"""

import json
import os
import sys
from datetime import UTC, datetime
from uuid import UUID, uuid4

import psycopg2

LOCAL_DEV_CALLER_ID = UUID("00000000-0000-0000-0000-000000000001")

DIALOGUE_ENTRIES = [
    {
        "speaker": "Judge",
        "text": (
            "Good morning. We are on the record."
            " This is the hearing for appeal reference PA/05217/2025."
        ),
        "start_time": 0.0,
        "end_time": 6.2,
        "confidence": 0.97,
        "corrected_text": None,
        "word_corrections": None,
        "correction_history": None,
        "words": None,
    },
    {
        "speaker": "Appellant",
        "text": "Good morning, Your Honour.",
        "start_time": 6.5,
        "end_time": 8.1,
        "confidence": 0.95,
        "corrected_text": None,
        "word_corrections": None,
        "correction_history": None,
        "words": None,
    },
    {
        "speaker": "Judge",
        "text": "Can you confirm your full name and date of birth for the record?",
        "start_time": 8.4,
        "end_time": 12.7,
        "confidence": 0.98,
        "corrected_text": None,
        "word_corrections": None,
        "correction_history": None,
        "words": None,
    },
    {
        "speaker": "Appellant",
        "text": (
            "Yes. My name is Ahmed Hassan and my date of birth"
            " is the fifteenth of March, nineteen eighty-nine."
        ),
        "start_time": 13.0,
        "end_time": 19.4,
        "confidence": 0.91,
        "corrected_text": None,
        "word_corrections": None,
        "correction_history": None,
        "words": None,
    },
    {
        "speaker": "Judge",
        "text": "Thank you. And you are represented today by counsel?",
        "start_time": 20.0,
        "end_time": 23.1,
        "confidence": 0.99,
        "corrected_text": None,
        "word_corrections": None,
        "correction_history": None,
        "words": None,
    },
    {
        "speaker": "Counsel",
        "text": "That is correct, Your Honour. I appear on behalf of the appellant.",
        "start_time": 23.5,
        "end_time": 27.8,
        "confidence": 0.96,
        "corrected_text": None,
        "word_corrections": None,
        "correction_history": None,
        "words": None,
    },
]


def seed(conn):
    now = datetime.now(UTC).isoformat()
    job_id = uuid4()

    with conn.cursor() as cur:
        # Upsert the local-dev caller so the FK is satisfied even if the API
        # hasn't received its first request yet.
        cur.execute(
            """
            INSERT INTO caller (id, name, hashed_key, webhook_secret, is_active, created_datetime)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                str(LOCAL_DEV_CALLER_ID),
                "local-dev",
                "",
                # Placeholder — webhook delivery is never used in local dev.
                "local-placeholder",
                True,
                now,
            ),
        )

        cur.execute(
            """
            INSERT INTO transcription_job (
                id, caller_id, status, audio_url, locale, enable_diarization,
                dialogue_entries, metadata, created_datetime, updated_datetime,
                needs_cleanup
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (
                str(job_id),
                str(LOCAL_DEV_CALLER_ID),
                "SUCCEEDED",  # SQLAlchemy stores enum member names, not values
                "http://local-placeholder/audio.wav",
                "en-GB",
                True,
                json.dumps(DIALOGUE_ENTRIES),
                json.dumps(
                    {
                        "case_reference": "PA/05217/2025",
                        "tribunal": "First-tier Tribunal — Immigration and Asylum Chamber",
                        "audio_file_name": "hearing_pa05217_2025.wav",
                    }
                ),
                now,
                now,
                False,
            ),
        )

    conn.commit()
    print(f"Seeded job {job_id} (PA/05217/2025) — status: succeeded")  # noqa: T201


def main():
    dsn = os.environ.get(
        "DATABASE_CONNECTION_STRING",
        "postgresql://dev:devpass@postgres:5432/transcription_svc",  # pragma: allowlist secret
    )
    try:
        conn = psycopg2.connect(dsn)
    except psycopg2.OperationalError as e:
        print(f"Could not connect to database: {e}", file=sys.stderr)  # noqa: T201
        sys.exit(1)

    try:
        seed(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
