"""Add a GIN index on transcription_job.dialogue_entries.

DIAAT-232: dialogue_entries is stored schemaless as JSONB (see 001), so no
column addition is needed to start persisting the new per-phrase
`alternatives` field (Azure's nBest array) added to the DialogueEntry model
in this same change — it's just another key inside the existing JSON blob,
and every existing row is unaffected (NULL/absent reads back as Python
`None` via the model's default).

What genuinely does need a migration is indexing: each entry's JSON payload
is now meaningfully larger (a full nBest array per phrase instead of just
the top choice), so a GIN index is added ahead of DIAAT-233/234 needing to
query into it (e.g. "jobs with a low-confidence word that has a
higher-confidence alternative") without a full-table JSON scan.

Revision ID: 005
Revises: 004
Create Date: 2026-07-15
"""

from alembic import op

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_transcription_job_dialogue_entries_gin",
        "transcription_job",
        ["dialogue_entries"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_transcription_job_dialogue_entries_gin", table_name="transcription_job")
