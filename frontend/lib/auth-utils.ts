import "server-only";
import type { NextRequest } from "next/server";

export interface BackendAuthContext {
  accessToken: string | null;
  clientPrincipal: string | null;
}

export function getBackendAuthContext(request: NextRequest): BackendAuthContext {
  return {
    accessToken: request.headers.get("x-ms-token-aad-access-token"),
    clientPrincipal: request.headers.get("x-ms-client-principal"),
  };
}

// Kept for callers that only need the token (e.g. tests).
export function getEasyAuthToken(request: NextRequest): string | null {
  return request.headers.get("x-ms-token-aad-access-token");
}
