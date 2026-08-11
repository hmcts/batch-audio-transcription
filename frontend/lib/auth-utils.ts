import "server-only";
import type { NextRequest } from "next/server";

export interface BackendAuthContext {
  accessToken: string | null;
  clientPrincipal: string | null;
}

export function getBackendAuthContext(
  request: NextRequest
): BackendAuthContext {
  // Only trust x-ms-client-principal when Easy Auth is active at the platform
  // layer (EASY_AUTH_ENABLED=true in deployed environments). Without this gate,
  // a caller in local dev — where the Next.js auth middleware is bypassed — could
  // inject the header and have it forwarded to the backend alongside a valid
  // service API key, enabling user impersonation.
  const easyAuthEnabled = process.env.EASY_AUTH_ENABLED === "true";
  return {
    accessToken: request.headers.get("x-ms-token-aad-access-token"),
    clientPrincipal: easyAuthEnabled
      ? request.headers.get("x-ms-client-principal")
      : null,
  };
}
