import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockHeaders } = vi.hoisted(() => ({ mockHeaders: vi.fn() }));

vi.mock("next/headers", () => ({ headers: mockHeaders }));

function headerBag(map: Record<string, string>): Pick<Headers, "get"> {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("auth-utils", () => {
  const original = process.env.EASY_AUTH_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.EASY_AUTH_ENABLED = original;
  });

  describe("getBackendAuthContext", () => {
    it("forwards the client principal and token when Easy Auth is enabled", async () => {
      process.env.EASY_AUTH_ENABLED = "true";
      const { getBackendAuthContext } = await import("@/lib/auth-utils");

      const request = {
        headers: headerBag({
          "x-ms-token-aad-access-token": "tok",
          "x-ms-client-principal": "principal",
        }),
      } as unknown as NextRequest;

      expect(getBackendAuthContext(request)).toEqual({
        accessToken: "tok",
        clientPrincipal: "principal",
      });
    });

    it("drops the client principal when Easy Auth is disabled", async () => {
      process.env.EASY_AUTH_ENABLED = "false";
      const { getBackendAuthContext } = await import("@/lib/auth-utils");

      const request = {
        headers: headerBag({
          "x-ms-token-aad-access-token": "tok",
          "x-ms-client-principal": "principal",
        }),
      } as unknown as NextRequest;

      expect(getBackendAuthContext(request)).toEqual({
        accessToken: "tok",
        clientPrincipal: null,
      });
    });
  });

  describe("getServerComponentAuthContext", () => {
    it("reads request headers from next/headers and forwards the principal when enabled", async () => {
      process.env.EASY_AUTH_ENABLED = "true";
      mockHeaders.mockResolvedValue(
        headerBag({
          "x-ms-token-aad-access-token": "tok",
          "x-ms-client-principal": "principal",
        })
      );
      const { getServerComponentAuthContext } = await import(
        "@/lib/auth-utils"
      );

      await expect(getServerComponentAuthContext()).resolves.toEqual({
        accessToken: "tok",
        clientPrincipal: "principal",
      });
    });

    it("drops the client principal when Easy Auth is disabled", async () => {
      process.env.EASY_AUTH_ENABLED = "false";
      mockHeaders.mockResolvedValue(
        headerBag({ "x-ms-client-principal": "principal" })
      );
      const { getServerComponentAuthContext } = await import(
        "@/lib/auth-utils"
      );

      await expect(getServerComponentAuthContext()).resolves.toEqual({
        accessToken: null,
        clientPrincipal: null,
      });
    });
  });
});
