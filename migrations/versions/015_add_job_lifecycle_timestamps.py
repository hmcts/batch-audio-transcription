"""Add processing_started_datetime and stuck_reported_at to transcription_job (DIAAT-281).

processing_started_datetime: when Azure Speech started processing the job, so queue
  wait (created -> processing started) can be separated from processing time.
stuck_reported_at: set once by the replica that reports the job as stuck, so the
  job.stuck event is emitted once per job.
Both nullable: existing rows simply have no value.

Revision ID: 015
Revises: 014
Create Date: 2026-10-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transcription_job",
        sa.Column("processing_started_datetime", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "transcription_job",
        sa.Column("stuck_reported_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("transcription_job", "stuck_reported_at")
    op.drop_column("transcription_job", "processing_started_datetime")
