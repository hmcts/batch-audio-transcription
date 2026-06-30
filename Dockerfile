# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Run as non-root
RUN addgroup --system --gid 1001 appuser \
 && adduser --system --uid 1001 --ingroup appuser appuser

WORKDIR /app

COPY pyproject.toml .
COPY src/ src/
RUN pip install --no-cache-dir "."
COPY migrations/ migrations/
COPY alembic.ini .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

ENV PYTHONPATH=/app/src
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

USER appuser

EXPOSE 8001

ENTRYPOINT ["./entrypoint.sh"]
