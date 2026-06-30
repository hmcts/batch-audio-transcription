# syntax=docker/dockerfile:1.7

# ── Stage 1: Frontend dependencies ──────────────────────────────────────────
FROM node:24-alpine AS frontend-deps
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-bat,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store

# ── Stage 2: Frontend build ──────────────────────────────────────────────────
FROM node:24-alpine AS frontend-builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app/frontend
COPY --from=frontend-deps /app/frontend/node_modules ./node_modules
COPY frontend/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,id=next-bat,target=/app/frontend/.next/cache \
    pnpm run build

# ── Stage 3: Combined runtime ────────────────────────────────────────────────
FROM python:3.12-slim AS runner

# Copy Caddy binary from official image (avoids curl + manual download)
COPY --from=caddy:2.9 /usr/bin/caddy /usr/bin/caddy

# Install Node 24, ffmpeg, supervisor
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl gnupg2 ffmpeg supervisor && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 appuser \
 && adduser --system --uid 1001 --ingroup appuser appuser

WORKDIR /app

# Python backend
COPY pyproject.toml .
COPY src/ src/
RUN pip install --no-cache-dir "."
COPY migrations/ migrations/
COPY alembic.ini .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Next.js standalone output
WORKDIR /app/frontend
COPY --from=frontend-builder /app/frontend/.next/standalone ./
COPY --from=frontend-builder /app/frontend/.next/static ./.next/static
COPY --from=frontend-builder /app/frontend/public ./public
RUN chown -R appuser:appuser /app/frontend

# Proxy and process manager config
COPY Caddyfile /etc/caddy/Caddyfile
COPY supervisord.conf /etc/supervisord.conf

WORKDIR /app
RUN chown -R appuser:appuser /app

ENV PYTHONPATH=/app/src
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NEXT_TELEMETRY_DISABLED=1

USER appuser

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
