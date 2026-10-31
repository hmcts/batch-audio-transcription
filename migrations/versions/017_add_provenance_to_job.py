"""Add transcription_job.provenance (DIAAT-286).

The technical configuration that produced the transcript (Azure Speech resource,
API version, locale, model, Azure job ID, submission options, application release,
generation time, spelling dictionary version, speaker-processing steps), written in
the same transaction as the results. Configuration only, never content. Nullable:
jobs completed before this migration, and jobs that have not succeeded, have none.

Revision ID: 017
Revises: 016
Create Date: 2026-10-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transcription_job",
        sa.Column("provenance", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("transcription_job", "provenance")
