import { type NextRequest, NextResponse } from "next/server";

/**
 * Enforces Azure Easy Auth login on all routes except Next.js internals and Easy Auth endpoints.
 *
 * In production (Azure App Service with Easy Auth configured), the
 * AppServiceAuthSession cookie is set by the platform after a successful AAD
 * login. Its absence means the request is unauthenticated; we redirect to the
 * Easy Auth login endpoint which then redirects to Azure AD.
 *
 * In local development (NODE_ENV === "development") the gate is skipped so
 * developers can work without Azure AD credentials.
 */
// Served under the /batch basePath as GET /batch/api/version; the basePath is
// stripped before middleware runs, so the path seen here is /api/version.
const PUBLIC_PATHS = new Set(["/api/version"]);

export function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";

  // The version endpoint is polled unauthenticated by the post-deploy
  // version-gated check (DIAAT-241) and only exposes the build SHA. Keep it
  // public: Easy Auth already excludes it at the platform layer, but this
  // middleware runs behind Easy Auth and would otherwise redirect it to login.
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (!isDev) {
    const authCookie = request.cookies.get("AppServiceAuthSession");

    if (!authCookie) {
      const loginUrl = new URL("/.auth/login/aad", request.url);
      loginUrl.searchParams.set(
        "post_login_redirect_uri",
        `${request.nextUrl.pathname}${request.nextUrl.search}`
      );
      return NextResponse.redirect(loginUrl);
    }
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
