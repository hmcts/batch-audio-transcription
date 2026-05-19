FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Run as non-root
RUN addgroup --system --gid 1001 appuser \
 && adduser --system --uid 1001 --ingroup appuser appuser

WORKDIR /app

COPY pyproject.toml .
# Install production dependencies only — dev extras (pytest, coverage, ruff)
# are not needed at runtime and increase attack surface.
RUN pip install --no-cache-dir -e "."

COPY src/ src/
COPY migrations/ migrations/
COPY alembic.ini .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

ENV PYTHONPATH=/app/src
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Migrations run at container start via entrypoint.sh (not at build time —
# the database is unavailable during image build).
USER appuser

ENTRYPOINT ["./entrypoint.sh"]
