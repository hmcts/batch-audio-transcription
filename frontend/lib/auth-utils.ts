import "server-only";
import type { NextRequest } from "next/server";

/**
 * Build the set of auth headers to forward from an incoming browser request to
 * the backend API.
 *
 * The backend's `hmcts_azure_auth.get_current_user` requires the
 * `X-Ms-Client-Principal` header that Azure Easy Auth injects on the frontend
 * App Service. Because the backend API is NOT itself behind Easy Auth, the
 * frontend must forward that header (and its companions) explicitly — otherwise
 * every authenticated call is rejected with 401.
 *
 * We read each header by name via `request.headers.get(...)` rather than
 * iterating `.entries()`, because platform-injected headers may be absent from
 * `.entries()` in the Next.js App Router. Only present (truthy) values are
 * included, keyed by their lowercase header name.
 *
 * The AAD access token, when present, is promoted to `Authorization: Bearer`.
 *
 * Returns an empty record in local development (none of the headers are
 * present) — callers fall back to the service API key in that case.
 *
 * @param request - Next.js route handler request object
 * @returns A record of headers to forward to the backend (may be empty)
 */
export function getBackendAuthHeaders(
  request: NextRequest
): Record<string, string> {
  const headers: Record<string, string> = {};

  const principalHeaders = [
    "x-ms-client-principal",
    "x-ms-client-principal-id",
    "x-ms-client-principal-name",
    "x-ms-client-principal-idp",
  ];
  for (const name of principalHeaders) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  const aadToken = request.headers.get("x-ms-token-aad-access-token");
  if (aadToken) headers.Authorization = `Bearer ${aadToken}`;

  return headers;
}
