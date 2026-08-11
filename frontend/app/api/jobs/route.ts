import { type NextRequest, NextResponse } from "next/server";
import { listJobs } from "@/lib/api-client";
import { getBackendAuthContext } from "@/lib/auth-utils";

export async function GET(request: NextRequest) {
  const auth = getBackendAuthContext(request);
  try {
    const result = await listJobs(undefined, auth);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to list jobs", err);
    return NextResponse.json(
      { error: "Failed to load transcription jobs" },
      { status: 502 }
    );
  }
}
