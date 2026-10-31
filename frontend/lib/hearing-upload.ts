// DIAAT-280: one hearing-level correlation ID for every file uploaded together
// for a hearing, so the backend's upload telemetry can relate them (X-Hearing-Id
// is the parent of each file's upload journey). The browser creates one per
// upload batch and sends it, with the batch's file count, to /api/upload, which
// validates it and forwards it to the backend. Shared by the browser and the
// server, so it must not import anything server-only.

export interface HearingUpload {
  hearingId: string;
  fileCount: number;
}

// Matches the backend's accepted range for X-Hearing-File-Count.
export const MAX_HEARING_FILES = 50;

// Form fields the browser sends to /api/upload alongside each file.
export const HEARING_ID_FIELD = "hearing_id";
export const HEARING_FILE_COUNT_FIELD = "hearing_file_count";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_COUNT_RE = /^[0-9]{1,2}$/;

export function newHearingUpload(fileCount: number): HearingUpload {
  return { hearingId: crypto.randomUUID(), fileCount };
}

/**
 * The hearing from the /api/upload form fields, or undefined unless both are
 * valid (a UUID, and an integer in 1..MAX_HEARING_FILES). An upload without
 * one simply has no hearing; one is never invented per file.
 */
export function parseHearingUpload(
  rawId: unknown,
  rawCount: unknown
): HearingUpload | undefined {
  if (typeof rawId !== "string" || !UUID_RE.test(rawId)) return undefined;
  if (typeof rawCount !== "string" || !FILE_COUNT_RE.test(rawCount)) {
    return undefined;
  }
  const fileCount = Number(rawCount);
  if (fileCount < 1 || fileCount > MAX_HEARING_FILES) return undefined;
  return { hearingId: rawId, fileCount };
}

export interface UploadBatchFile {
  file: File;
  durationSeconds?: number;
}

/**
 * One /api/upload form per file of an upload batch, all carrying the same
 * hearing ID and the batch's file count.
 */
export function buildHearingUploadForms(
  files: UploadBatchFile[],
  hearing: HearingUpload = newHearingUpload(files.length)
): FormData[] {
  return files.map(({ file, durationSeconds }) => {
    const formData = new FormData();
    formData.append("file", file);
    if (durationSeconds !== undefined) {
      formData.append("audio_duration_seconds", String(durationSeconds));
    }
    formData.append(HEARING_ID_FIELD, hearing.hearingId);
    formData.append(HEARING_FILE_COUNT_FIELD, String(hearing.fileCount));
    return formData;
  });
}
