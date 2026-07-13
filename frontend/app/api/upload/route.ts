import { NextResponse } from "next/server";
import { uploadAndSubmit } from "@/lib/api-client";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const filename = file instanceof File ? file.name : "audio";

  try {
    const job = await uploadAndSubmit(file, filename);
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    console.error("Failed to upload and submit job", err);
    return NextResponse.json(
      { error: "Failed to submit audio for transcription" },
      { status: 502 }
    );
  }
}
