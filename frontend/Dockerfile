# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base

# Enable corepack for pnpm support
RUN corepack enable && corepack prepare pnpm@10 --activate

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager.
# The cache mount preserves pnpm's content-addressable store across
# builds, so re-installs only re-fetch packages that genuinely changed
# in the lockfile rather than the whole graph.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-bat,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Cache .next/cache (webpack/SWC/babel-loader incremental output)
# across builds. The mount only exists during this RUN, so
# .next/standalone and .next/static — which the runner stage copies —
# are still written to the real layer.
RUN --mount=type=cache,id=next-bat,target=/app/.next/cache \
    pnpm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Git commit SHA baked in at build time (passed via --build-arg GIT_SHA in
# ci-build-image.yml). Read at runtime by the /batch/api/version route (which
# is force-dynamic, so it reads this container env var per request). Defaults
# to "unknown" so local builds without the arg still work.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

RUN apk add --no-cache caddy supervisor

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY supervisord.conf /etc/supervisord.conf
COPY Caddyfile /etc/caddy/Caddyfile

USER nextjs

EXPOSE 3000

# Next.js listens on 3001 (localhost only); Caddy listens on 3000.
# PORT and HOSTNAME are consumed by the standalone server.js.
ENV PORT=3001
ENV HOSTNAME="127.0.0.1"

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
