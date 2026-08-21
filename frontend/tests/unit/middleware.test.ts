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

  it("lets the version endpoint through without auth (public for the deploy gate)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = middleware(request("/api/version"));
    // NextResponse.next() has no redirect Location header.
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects unauthenticated requests to the Easy Auth login endpoint", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = middleware(request("/some/protected/page"));
    const location = res.headers.get("location");
    expect(location).toContain("/.auth/login/aad");
    expect(location).toContain(
      "post_login_redirect_uri=%2Fsome%2Fprotected%2Fpage"
    );
  });

  it("allows authenticated requests (AppServiceAuthSession cookie present)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = middleware(request("/some/protected/page", { cookie: true }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("skips the gate entirely in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = middleware(request("/some/protected/page"));
    expect(res.headers.get("location")).toBeNull();
  });
});
