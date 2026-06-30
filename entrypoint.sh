#!/bin/sh
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Starting server..."
exec python -m uvicorn transcription_svc.main:app \
  --host 0.0.0.0 \
  --port "${UVICORN_PORT:-8001}" \
  --log-level info
