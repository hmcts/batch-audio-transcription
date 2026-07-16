import { NextResponse } from "next/server";
import { BackendApiError, uploadBaselineTranscript } from "@/lib/api-client";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { jobId } = await params;

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const filename = file instanceof File ? file.name : "baseline.txt";

    const job = await uploadBaselineTranscript(jobId, file, filename);
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof BackendApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to upload baseline transcript", err);
    return NextResponse.json(
      { error: "Failed to upload baseline transcript" },
      { status: 502 }
    );
  }
}
