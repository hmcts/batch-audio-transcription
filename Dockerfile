# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Run as non-root
RUN addgroup --system --gid 1001 appuser \
 && adduser --system --uid 1001 --ingroup appuser appuser

WORKDIR /app

COPY vendor/ vendor/
COPY pyproject.toml uv.lock ./
COPY src/ src/
# Install the versions pinned in uv.lock (what CI tests run against). Resolving
# pyproject ranges at build time lets upstream releases change runtime
# behaviour, e.g. SQLAlchemy 2.1 maps postgresql:// to psycopg 3, not psycopg2.
RUN --mount=from=ghcr.io/astral-sh/uv:0.11.8,source=/uv,target=/bin/uv \
    uv export --frozen --no-dev --no-emit-project --no-hashes -o requirements.txt \
 && pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir --no-deps . \
 && rm -rf vendor/ requirements.txt
COPY migrations/ migrations/
COPY alembic.ini .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Git commit SHA baked in at build time (passed via --build-arg GIT_SHA in
# ci-build-image.yml). Read at runtime by GET /api/v1/version. Defaults to
# "unknown" so local builds without the arg still work.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

ENV PYTHONPATH=/app/src
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

USER appuser

EXPOSE 8001

ENTRYPOINT ["./entrypoint.sh"]
