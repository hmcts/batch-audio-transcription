import { type NextRequest, NextResponse } from "next/server";
import { uploadAndSubmit } from "@/lib/api-client";
import { getEasyAuthToken } from "@/lib/auth-utils";

export async function POST(request: NextRequest) {
  const accessToken = getEasyAuthToken(request);

  // Next.js truncates request bodies larger than
  // experimental.proxyClientMaxBodySize (configured in next.config.ts), which
  // corrupts the multipart payload so formData() throws. Handle it here to
  // return a clear 413 instead of an opaque 500.
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    console.error("Failed to parse upload request body", err);
    return NextResponse.json(
      {
        error: "Uploaded file is too large or the request body was malformed.",
      },
      { status: 413 }
    );
  }

  const file = form.get("file");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const filename = file instanceof File ? file.name : "audio";

  // Number() (unlike parseFloat) rejects partially-numeric strings like
  // "123abc" as NaN, so only a fully-numeric, positive value is accepted;
  // anything else is dropped and the duration is simply omitted.
  const rawDuration = form.get("audio_duration_seconds");
  const parsedDuration =
    typeof rawDuration === "string" && rawDuration.trim() !== ""
      ? Number(rawDuration)
      : Number.NaN;
  const audioDurationSeconds =
    Number.isFinite(parsedDuration) && parsedDuration > 0
      ? parsedDuration
      : undefined;

  try {
    const job = await uploadAndSubmit(
      file,
      filename,
      audioDurationSeconds,
      accessToken
    );
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    console.error("Failed to upload and submit job", err);
    return NextResponse.json(
      { error: "Failed to submit audio for transcription" },
      { status: 502 }
    );
  }
}
