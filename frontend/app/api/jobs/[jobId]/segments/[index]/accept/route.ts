import { NextResponse } from "next/server";
import { acceptSegment, BackendApiError } from "@/lib/api-client";

interface RouteContext {
  params: Promise<{ jobId: string; index: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const { jobId, index } = await params;
  const segmentIndex = Number(index);
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    return NextResponse.json(
      { error: "Invalid segment index" },
      { status: 422 }
    );
  }

  try {
    const job = await acceptSegment(jobId, segmentIndex);
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to accept segment", err);
    return NextResponse.json(
      { error: "Failed to accept segment" },
      { status: 502 }
    );
  }
}
