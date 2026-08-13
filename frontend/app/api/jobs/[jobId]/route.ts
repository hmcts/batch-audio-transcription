import { type NextRequest, NextResponse } from "next/server";
import { BackendApiError, deleteJob, getJob } from "@/lib/api-client";
import { getBackendAuthContext } from "@/lib/auth-utils";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { jobId } = await params;
  const auth = getBackendAuthContext(request);
  try {
    const job = await getJob(jobId, auth);
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

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { jobId } = await params;
  const auth = getBackendAuthContext(request);
  try {
    await deleteJob(jobId, auth);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof BackendApiError && err.status === 404) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    console.error("Failed to delete job", err);
    return NextResponse.json(
      { error: "Failed to delete transcription job" },
      { status: 502 }
    );
  }
}
