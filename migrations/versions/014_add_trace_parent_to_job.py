"""Add trace_parent to transcription_job (DIAAT-276).

Stores the W3C traceparent of the request that created a job, so the polling
service can link the job's later processing to it (end-to-end job tracing).
Nullable: jobs created before this migration simply have no link.

Revision ID: 014
Revises: 013
Create Date: 2026-10-16
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transcription_job",
        sa.Column("trace_parent", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("transcription_job", "trace_parent")
