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
