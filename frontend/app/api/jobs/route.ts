import { type NextRequest, NextResponse } from "next/server";
import { listJobs } from "@/lib/api-client";
import { getEasyAuthToken } from "@/lib/auth-utils";

export async function GET(request: NextRequest) {
  const accessToken = getEasyAuthToken(request);
  try {
    const result = await listJobs(undefined, accessToken);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to list jobs", err);
    return NextResponse.json(
      { error: "Failed to load transcription jobs" },
      { status: 502 }
    );
  }
}
