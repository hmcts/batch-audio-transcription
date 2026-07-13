import "server-only";
import type { JobStatus, TranscriptionJob, TranscriptSegment } from "./types";

// Server-only client for the transcription_svc backend. Never import this
// from a "use client" component — it reads the backend API key, which must
// not reach the browser bundle. Route handlers under app/api/** are the
// bridge between client components and this module.

interface BackendDialogueEntry {
  speaker: string;
  text: string;
  start_time: number;
  end_time: number;
}

interface BackendJob {
  job_id: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  dialogue_entries: BackendDialogueEntry[] | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

interface BackendJobList {
  jobs: BackendJob[];
  total: number;
  limit: number;
  offset: number;
}

interface BackendUpload {
  audio_url: string;
  blob_name: string;
}

export class BackendApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "BackendApiError";
  }
}

function backendUrl(): string {
  return process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8001";
}

function apiKey(): string {
  const key = process.env.TRANSCRIPTION_API_KEY;
  if (!key) {
    throw new Error("TRANSCRIPTION_API_KEY is not configured");
  }
  return key;
}

async function backendFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(`${backendUrl()}${path}`, {
    ...init,
    // Authorization is spread last so a caller-supplied header (present or
    // future) can never accidentally override the backend bearer token.
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${apiKey()}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new BackendApiError(
      `Backend request to ${path} failed: ${response.status} ${body}`,
      response.status
    );
  }

  return response;
}

const STATUS_MAP: Record<string, JobStatus> = {
  pending: "PENDING",
  submitted: "PROCESSING",
  running: "PROCESSING",
  succeeded: "COMPLETED",
  failed: "FAILED",
};

// The backend doesn't report fractional batch progress, so processing jobs
// show a fixed stage-based estimate rather than a precise percentage.
const PROGRESS_BY_STATUS: Record<string, number> = {
  pending: 0,
  submitted: 25,
  running: 60,
  succeeded: 100,
  failed: 100,
};

const SPEAKER_COLORS = [
  "#6d28d9",
  "#1d4ed8",
  "#065f46",
  "#92400e",
  "#9f1239",
  "#374151",
];

export function colorForSpeaker(speaker: string): string {
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = (hash * 31 + speaker.charCodeAt(i)) >>> 0;
  }
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length];
}

function toSegments(
  entries: BackendDialogueEntry[] | null
): TranscriptSegment[] | undefined {
  if (!entries || entries.length === 0) return undefined;
  return entries.map((entry, index) => ({
    id: `seg-${index}`,
    speaker: `Speaker ${entry.speaker}`,
    speakerColor: colorForSpeaker(entry.speaker),
    text: entry.text,
    startTime: entry.start_time,
    duration: Math.max(0, entry.end_time - entry.start_time),
  }));
}

function toTranscriptionJob(job: BackendJob): TranscriptionJob {
  const status = STATUS_MAP[job.status] ?? "PENDING";
  const meta = job.metadata ?? {};

  return {
    id: job.job_id,
    caseReference:
      typeof meta.case_reference === "string"
        ? meta.case_reference
        : job.job_id,
    tribunal:
      typeof meta.tribunal === "string"
        ? meta.tribunal
        : "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName:
      typeof meta.audio_file_name === "string" ? meta.audio_file_name : "audio",
    uploadedAt: job.created_at,
    completedAt:
      status === "COMPLETED" || status === "FAILED"
        ? (job.updated_at ?? undefined)
        : undefined,
    status,
    progressPercent: PROGRESS_BY_STATUS[job.status] ?? 0,
    segments: toSegments(job.dialogue_entries),
  };
}

export async function listJobs(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ jobs: TranscriptionJob[]; total: number; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.size ? `?${query}` : "";
  const response = await backendFetch(`/api/v1/jobs${qs}`);
  const body: BackendJobList = await response.json();
  return {
    jobs: body.jobs.map(toTranscriptionJob),
    total: body.total,
    limit: body.limit,
    offset: body.offset,
  };
}

export async function getJob(jobId: string): Promise<TranscriptionJob | null> {
  try {
    const response = await backendFetch(`/api/v1/jobs/${jobId}`);
    const body: BackendJob = await response.json();
    return toTranscriptionJob(body);
  } catch (err) {
    // 404: no job with that id. 422: the backend validates job_id as a UUID
    // path param and rejects anything else before it can even look it up —
    // from the caller's perspective that's just as much "not found".
    if (
      err instanceof BackendApiError &&
      (err.status === 404 || err.status === 422)
    ) {
      return null;
    }
    throw err;
  }
}

export async function uploadAudio(
  file: Blob,
  filename: string
): Promise<BackendUpload> {
  const form = new FormData();
  form.append("file", file, filename);

  const response = await backendFetch("/api/v1/uploads", {
    method: "POST",
    body: form,
  });
  return response.json();
}

export interface SubmitJobMetadata {
  caseReference: string;
  tribunal: string;
  audioFileName: string;
}

export async function submitJob(
  audioUrl: string,
  metadata: SubmitJobMetadata
): Promise<TranscriptionJob> {
  const response = await backendFetch("/api/v1/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_url: audioUrl,
      metadata: {
        case_reference: metadata.caseReference,
        tribunal: metadata.tribunal,
        audio_file_name: metadata.audioFileName,
      },
    }),
  });
  const body: BackendJob = await response.json();
  return toTranscriptionJob(body);
}

export async function uploadAndSubmit(
  file: Blob,
  filename: string
): Promise<TranscriptionJob> {
  const { audio_url } = await uploadAudio(file, filename);
  const caseReference = filename.replace(/\.[^.]+$/, "").replace(/_/g, "/");
  return submitJob(audio_url, {
    caseReference,
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: filename,
  });
}
