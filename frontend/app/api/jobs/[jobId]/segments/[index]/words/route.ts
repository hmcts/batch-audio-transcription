import { type NextRequest, NextResponse } from "next/server";
import { BackendApiError, correctWordRange } from "@/lib/api-client";
import { getEasyAuthToken } from "@/lib/auth-utils";

interface RouteContext {
  params: Promise<{ jobId: string; index: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
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
    const { startWordIndex, endWordIndex, correctedText } =
      await request.json();
    if (
      !Number.isInteger(startWordIndex) ||
      !Number.isInteger(endWordIndex) ||
      startWordIndex < 0 ||
      endWordIndex < 0 ||
      typeof correctedText !== "string" ||
      correctedText.trim().length === 0
    ) {
      return NextResponse.json(
        {
          error: "startWordIndex, endWordIndex and correctedText are required",
        },
        { status: 422 }
      );
    }
    const job = await correctWordRange(
      jobId,
      segmentIndex,
      startWordIndex,
      endWordIndex,
      correctedText,
      accessToken
    );
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to correct word range", err);
    return NextResponse.json(
      { error: "Failed to save correction" },
      { status: 502 }
    );
  }
}
