import "server-only";
import type { NextRequest } from "next/server";

/**
 * Extract the Azure Easy Auth access token from the incoming request headers.
 *
 * Azure App Service Easy Auth injects `x-ms-token-aad-access-token` on every
 * authenticated request when the app's authentication settings are configured.
 * This token can be forwarded directly to the backend as a Bearer token so the
 * backend can verify the caller's identity via JWT.
 *
 * Returns null in local development (the header is absent) — callers should
 * fall back to the service API key in that case.
 *
 * @param request - Next.js route handler request object
 * @returns The raw access token string, or null if the header is not present
 */
export function getEasyAuthToken(request: NextRequest): string | null {
  return request.headers.get("x-ms-token-aad-access-token");
}
