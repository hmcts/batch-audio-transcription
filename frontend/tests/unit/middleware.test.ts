import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";

function request(path: string, opts?: { cookie?: boolean }) {
  const req = new NextRequest(`https://frontend.example${path}`);
  if (opts?.cookie) {
    req.cookies.set("AppServiceAuthSession", "token");
  }
  return req;
}

describe("middleware auth gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("when Easy Auth is enforced (EASY_AUTH_ENABLED=true — stg/prod)", () => {
    it("redirects unauthenticated requests to the Easy Auth login endpoint", () => {
      vi.stubEnv("EASY_AUTH_ENABLED", "true");
      const res = middleware(request("/some/protected/page"));
      const location = res.headers.get("location");
      expect(location).toContain("/.auth/login/aad");
      expect(location).toContain(
        "post_login_redirect_uri=%2Fsome%2Fprotected%2Fpage"
      );
    });

    it("allows authenticated requests (AppServiceAuthSession cookie present)", () => {
      vi.stubEnv("EASY_AUTH_ENABLED", "true");
      const res = middleware(request("/some/protected/page", { cookie: true }));
      expect(res.headers.get("location")).toBeNull();
    });

    it("still lets the public version endpoint through without auth", () => {
      vi.stubEnv("EASY_AUTH_ENABLED", "true");
      const res = middleware(request("/api/version"));
      expect(res.headers.get("location")).toBeNull();
    });
  });

  describe("when Easy Auth is not enforced (dev / local)", () => {
    it("leaves the app open when EASY_AUTH_ENABLED=false (deployed dev)", () => {
      vi.stubEnv("EASY_AUTH_ENABLED", "false");
      const res = middleware(request("/some/protected/page"));
      expect(res.headers.get("location")).toBeNull();
    });

    it("leaves the app open when EASY_AUTH_ENABLED is unset (local dev)", () => {
      const res = middleware(request("/some/protected/page"));
      expect(res.headers.get("location")).toBeNull();
    });
  });
});
