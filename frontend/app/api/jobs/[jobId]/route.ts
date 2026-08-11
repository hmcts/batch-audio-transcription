import { type NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/api-client";
import { getBackendAuthHeaders } from "@/lib/auth-utils";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { jobId } = await params;
  const authHeaders = getBackendAuthHeaders(request);
  try {
    const job = await getJob(jobId, authHeaders);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ job });
  } catch (err) {
    console.error("Failed to load job", err);
    return NextResponse.json(
      { error: "Failed to load transcription job" },
      { status: 502 }
    );
  }
}
