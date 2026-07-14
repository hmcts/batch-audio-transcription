import { NextResponse } from "next/server";
import { getJobAudio } from "@/lib/api-client";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  const { jobId } = await params;
  try {
    // Forward the browser's Range header so <audio> seeking works — without
    // this, the browser can request a byte range it never receives and
    // seeking on an unbuffered position silently does nothing.
    const backendResponse = await getJobAudio(
      jobId,
      request.headers.get("range")
    );
    // Forward the backend's status verbatim — 200/206 for real audio, but
    // also 404 (no job/blob) and 416 (unsatisfiable range) need to reach
    // the browser with their real Content-Range so <audio> can react
    // correctly instead of every non-2xx collapsing into the same error.
    if (!backendResponse.ok) {
      const headers: Record<string, string> = {};
      const contentRange = backendResponse.headers.get("Content-Range");
      if (contentRange) headers["Content-Range"] = contentRange;
      return NextResponse.json(
        { error: "Audio not available" },
        { status: backendResponse.status, headers }
      );
    }
    const headers: Record<string, string> = {
      "Content-Type":
        backendResponse.headers.get("Content-Type") ??
        "application/octet-stream",
    };
    for (const name of ["Accept-Ranges", "Content-Range", "Content-Length"]) {
      const value = backendResponse.headers.get(name);
      if (value) headers[name] = value;
    }
    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      headers,
    });
  } catch (err) {
    console.error("Failed to load job audio", err);
    return NextResponse.json(
      { error: "Failed to load audio" },
      { status: 502 }
    );
  }
}
