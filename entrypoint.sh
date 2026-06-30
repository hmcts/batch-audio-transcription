#!/bin/sh
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Starting services via supervisord..."
exec supervisord -c /etc/supervisord.conf
