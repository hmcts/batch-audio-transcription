import { NextResponse } from "next/server";
import { BackendApiError, rollbackToHistoryEntry } from "@/lib/api-client";

interface RouteContext {
  params: Promise<{ jobId: string; index: string; historyIndex: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
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

  try {
    const job = await rollbackToHistoryEntry(
      jobId,
      segmentIndex,
      targetHistoryIndex
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
