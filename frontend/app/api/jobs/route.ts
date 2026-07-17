import { NextResponse } from "next/server";
import { listJobs } from "@/lib/api-client";

export async function GET() {
  try {
    const result = await listJobs();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to list jobs", err);
    return NextResponse.json(
      { error: "Failed to load transcription jobs" },
      { status: 502 }
    );
  }
}
