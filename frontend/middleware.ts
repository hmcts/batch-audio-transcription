import { type NextRequest, NextResponse } from "next/server";

/**
 * Enforces Azure Easy Auth login on all routes except Next.js internals and Easy Auth endpoints.
 *
 * The gate is active only where the platform Easy Auth is enabled, signalled by
 * EASY_AUTH_ENABLED="true" (set by Terraform on stg/prod). There, the
 * AppServiceAuthSession cookie is set by the platform after a successful AAD
 * login; its absence means the request is unauthenticated and we redirect to the
 * Easy Auth login endpoint, which then redirects to Azure AD.
 *
 * Dev (EASY_AUTH_ENABLED="false") and local development (unset) are left open so
 * the app can be exercised — Playwright e2e, quick manual checks — without an AAD
 * login. This mirrors auth_settings_v2.auth_enabled in the infra repo.
 */
// Served under the /batch basePath as GET /batch/api/version; the basePath is
// stripped before middleware runs, so the path seen here is /api/version.
const PUBLIC_PATHS = new Set(["/api/version"]);

export function middleware(request: NextRequest) {
  const authEnabled = process.env.EASY_AUTH_ENABLED === "true";

  // Open everywhere Easy Auth isn't enforced (dev / local), and always for the
  // public version endpoint (polled by the DIAAT-241 post-deploy check; it only
  // exposes the build SHA).
  if (!authEnabled || PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get("AppServiceAuthSession");

  if (!authCookie) {
    const loginUrl = new URL("/.auth/login/aad", request.url);
    loginUrl.searchParams.set(
      "post_login_redirect_uri",
      `${request.nextUrl.pathname}${request.nextUrl.search}`
    );
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    {
      // Run on all routes except Next.js internals, static assets, and the
      // Easy Auth endpoints (/.auth/*) — intercepting those would cause a
      // redirect loop because the login redirect itself would be re-checked.
      source: "/((?!_next/static|_next/image|favicon.ico|\\.auth).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
