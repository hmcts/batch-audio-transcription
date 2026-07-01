"""Seed courtstranscribe caller record.

Inserts the courtstranscribe service account into the caller table so that
courtstranscribe can authenticate against the batch transcription API.
Uses ON CONFLICT DO NOTHING so it is safe to re-run.
"""

import sqlalchemy as sa
from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO caller (id, created_datetime, name, hashed_key, key_lookup_hash, webhook_secret, is_active)
            SELECT
                gen_random_uuid(),
                NOW(),
                'courtstranscribe',
                '$2b$12$wxMi1/taneWX7OsZb7z5d.OW5Ak7CBJ1kMw5dTuGeuxFdbpv.pjeK',
                '32b8d8169714fe7e6e817e29c15f761becc623ce8055c9b6655ea55eb0e34959',
                'gAAAAABqRM7g1-k28jC9nV4UBPjhhSwVBmukiLuj3SACD4FCpIfvrogn1g449DPz4AJmMmM17Nxi-nrzKUJLEaq6r7IijbGXVYkx0lDH2geh_58pZQggW5wXpguKHxPS-52xCJzc3qUC',
                true
            WHERE NOT EXISTS (SELECT 1 FROM caller WHERE name = 'courtstranscribe')
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM caller WHERE name = 'courtstranscribe'"))
