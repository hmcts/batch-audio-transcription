// Single source of truth for the app's basePath. next.config.ts reads the
// same NEXT_PUBLIC_BASE_PATH env var so both stay in sync — changing the
// env var is the only edit needed to move the app to a different prefix.
//
// Client-side fetch() to root-relative paths like "/api/jobs" is NOT
// automatically prefixed with basePath by Next.js — only <Link>/router
// navigation gets that — so any fetch from a "use client" component to our
// own API routes must go through apiPath() or it 404s once basePath is set.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/batch";

export function apiPath(path: string): string {
  return `${BASE_PATH}${path}`;
}
