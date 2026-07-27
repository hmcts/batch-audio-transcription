import { type NextRequest, NextResponse } from "next/server";
import { BackendApiError, rollbackToHistoryEntry } from "@/lib/api-client";
import { getEasyAuthToken } from "@/lib/auth-utils";

interface RouteContext {
  params: Promise<{ jobId: string; index: string; historyIndex: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { jobId, index, historyIndex } = await params;
  const segmentIndex = Number(index);
  const targetHistoryIndex = Number(historyIndex);
  if (
    !Number.isInteger(segmentIndex) ||
    segmentIndex < 0 ||
    !Number.isInteger(targetHistoryIndex) ||
    targetHistoryIndex < 0
  ) {
    return NextResponse.json(
      { error: "Invalid segment or history index" },
      { status: 422 }
    );
  }

  const accessToken = getEasyAuthToken(request);
  try {
    const job = await rollbackToHistoryEntry(
      jobId,
      segmentIndex,
      targetHistoryIndex,
      accessToken
    );
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to roll back to history entry", err);
    return NextResponse.json(
      { error: "Failed to roll back to history entry" },
      { status: 502 }
    );
  }
}
