import "server-only";
import type { NextRequest } from "next/server";

export interface BackendAuthContext {
  accessToken: string | null;
  clientPrincipal: string | null;
}

/**
 * Build the backend auth context from any Headers-like source.
 *
 * Only trust x-ms-client-principal when Easy Auth is active at the platform
 * layer (EASY_AUTH_ENABLED=true in deployed environments). Without this gate,
 * a caller in local dev — where the Next.js auth middleware is bypassed — could
 * inject the header and have it forwarded to the backend alongside a valid
 * service API key, enabling user impersonation.
 */
function authContextFromHeaders(
  source: Pick<Headers, "get">
): BackendAuthContext {
  const easyAuthEnabled = process.env.EASY_AUTH_ENABLED === "true";
  return {
    accessToken: source.get("x-ms-token-aad-access-token"),
    clientPrincipal: easyAuthEnabled
      ? source.get("x-ms-client-principal")
      : null,
  };
}

/**
 * Route handlers: derive the backend auth context from the NextRequest.
 */
export function getBackendAuthContext(
  request: NextRequest
): BackendAuthContext {
  return authContextFromHeaders(request.headers);
}

/**
 * React Server Components have no NextRequest, so they must read the incoming
 * request headers from next/headers. Use this in server-rendered pages (e.g.
 * the transcript page) so they forward the Easy Auth identity to the backend
 * exactly like the route handlers do — otherwise the backend, which requires
 * the X-Ms-Client-Principal header, rejects the call with 401.
 *
 * next/headers is imported dynamically so this module stays usable from route
 * handlers (and their tests) without pulling the RSC-only headers() API into
 * every import.
 */
export async function getServerComponentAuthContext(): Promise<BackendAuthContext> {
  const { headers } = await import("next/headers");
  return authContextFromHeaders(await headers());
}
