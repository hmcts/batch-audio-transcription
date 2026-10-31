#!/bin/sh
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Starting server..."
# --no-access-log: request telemetry comes from OpenTelemetry (hmcts-otel); access
# lines duplicate it and include query strings.
exec python -m uvicorn transcription_svc.main:app \
  --host 0.0.0.0 \
  --port "${UVICORN_PORT:-8001}" \
  --log-level info \
  --no-access-log
