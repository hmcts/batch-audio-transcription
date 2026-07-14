import { NextResponse } from "next/server";
import { getJob } from "@/lib/api-client";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { jobId } = await params;
  try {
    const job = await getJob(jobId);
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
