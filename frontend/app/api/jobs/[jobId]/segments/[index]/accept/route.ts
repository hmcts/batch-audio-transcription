import { type NextRequest, NextResponse } from "next/server";
import { acceptSegment, BackendApiError } from "@/lib/api-client";
import { getEasyAuthToken } from "@/lib/auth-utils";

interface RouteContext {
  params: Promise<{ jobId: string; index: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { jobId, index } = await params;
  const segmentIndex = Number(index);
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    return NextResponse.json(
      { error: "Invalid segment index" },
      { status: 422 }
    );
  }

  const accessToken = getEasyAuthToken(request);
  try {
    const job = await acceptSegment(jobId, segmentIndex, accessToken);
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
