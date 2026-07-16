import { NextResponse } from "next/server";

// Served under the /batch basePath as GET /batch/api/version. Reports the git
// commit SHA baked into the container image at build time (Dockerfile
// ARG GIT_SHA -> ENV GIT_SHA), read from process.env at request time so the
// post-deploy version-gated check (DIAAT-241) can confirm the live build.
// force-dynamic guarantees the value is read from the container's env at
// runtime rather than being inlined during `next build`.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ version: process.env.GIT_SHA ?? "unknown" });
}
