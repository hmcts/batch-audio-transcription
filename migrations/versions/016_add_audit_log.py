"""Add the audit_log table (DIAAT-286).

One row per sensitive action on a job: viewed, exported, deleted, submitted, or
refused. Who (actor_id: the internal user ID, never an email or name), what (action,
object_type, object_id), when (timestamp), whether it worked (outcome) and in which
request (request_id, the hmcts.request.id of the request's telemetry). detail holds
controlled values only, never content. Append-only: the application only inserts.

No foreign keys on purpose: a record must outlive the job it names (job.delete) and
the user. Indexed for "what did this user do" (actor_id, timestamp), "who touched
this job" (object_id) and time-range scans (timestamp).

Retention and access are pending the security and data decision (no purge yet).

Revision ID: 016
Revises: 015
Create Date: 2026-10-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("object_type", sa.String(length=16), nullable=False),
        sa.Column("object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("detail", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "outcome IN ('success', 'denied', 'failed')", name="ck_audit_log_outcome"
        ),
    )
    op.create_index("ix_audit_log_timestamp", "audit_log", ["timestamp"])
    op.create_index("ix_audit_log_actor_id_timestamp", "audit_log", ["actor_id", "timestamp"])
    op.create_index("ix_audit_log_object_id", "audit_log", ["object_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_object_id", table_name="audit_log")
    op.drop_index("ix_audit_log_actor_id_timestamp", table_name="audit_log")
    op.drop_index("ix_audit_log_timestamp", table_name="audit_log")
    op.drop_table("audit_log")
