import { type NextRequest, NextResponse } from "next/server";
import { uploadAndSubmit } from "@/lib/api-client";
import { getBackendAuthContext } from "@/lib/auth-utils";

// Next.js truncates request bodies larger than experimental.proxyClientMaxBodySize
// (configured in next.config.ts); the truncated multipart body then fails to
// parse with a TypeError referencing the missing FormData boundary. Match that
// specific failure so we can return 413, while letting anything unexpected
// surface as a normal 500 rather than being mislabelled.
function isBodyParseError(err: unknown): boolean {
  if (!(err instanceof TypeError)) {
    return false;
  }
  const cause = err.cause instanceof Error ? err.cause.message : "";
  const message = `${err.message} ${cause}`;
  return (
    message.includes("Failed to parse body as FormData") ||
    message.includes("boundary")
  );
}

export async function POST(request: NextRequest) {
  const auth = getBackendAuthContext(request);

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    if (!isBodyParseError(err)) {
      throw err;
    }
    console.error("Rejected oversized or malformed upload body", err);
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
    const job = await uploadAndSubmit(file, filename, audioDurationSeconds, auth);
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    console.error("Failed to upload and submit job", err);
    return NextResponse.json(
      { error: "Failed to submit audio for transcription" },
      { status: 502 }
    );
  }
}
