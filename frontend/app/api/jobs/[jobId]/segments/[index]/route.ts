import { NextResponse } from "next/server";
import { BackendApiError, correctSegment } from "@/lib/api-client";

interface RouteContext {
  params: Promise<{ jobId: string; index: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { jobId, index } = await params;
  const segmentIndex = Number(index);
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    return NextResponse.json(
      { error: "Invalid segment index" },
      { status: 422 }
    );
  }

  try {
    const { correctedText } = await request.json();
    if (
      typeof correctedText !== "string" ||
      correctedText.trim().length === 0
    ) {
      return NextResponse.json(
        { error: "correctedText is required" },
        { status: 422 }
      );
    }
    const job = await correctSegment(jobId, segmentIndex, correctedText);
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to correct segment", err);
    return NextResponse.json(
      { error: "Failed to save correction" },
      { status: 502 }
    );
  }
}
