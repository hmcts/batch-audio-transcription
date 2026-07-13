// Single source of truth for the app's basePath (next.config.ts and any
// client-side fetch() call both need this). Client-side fetch() to root-
// relative paths like "/api/jobs" is NOT automatically prefixed with
// basePath by Next.js — only <Link>/router navigation gets that — so any
// fetch from a "use client" component to our own API routes must go
// through apiPath() below or it 404s once basePath is non-empty.
export const BASE_PATH = "/batch";

export function apiPath(path: string): string {
  return `${BASE_PATH}${path}`;
}
