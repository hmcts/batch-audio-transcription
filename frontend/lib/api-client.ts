import "server-only";
import type {
  JobStatus,
  LowConfidenceSegment,
  TranscriptAccuracy,
  TranscriptionJob,
  TranscriptSegment,
  Word,
} from "./types";

// Server-only client for the transcription_svc backend. Never import this
// from a "use client" component — it reads the backend API key, which must
// not reach the browser bundle. Route handlers under app/api/** are the
// bridge between client components and this module.

interface BackendWordInfo {
  text: string;
  start_time: number;
  end_time: number;
  confidence: number;
}

interface BackendDialogueEntry {
  speaker: string;
  text: string;
  start_time: number;
  end_time: number;
  confidence?: number | null;
  corrected_text?: string | null;
  words?: BackendWordInfo[] | null;
}

interface BackendAccuracy {
  confidence_score: number;
  words_transcribed: number;
  low_confidence_count: number;
  confidence_threshold: number;
  has_corrections: boolean;
  word_error_rate: number | null;
  corrected_percent: number | null;
}

interface BackendNeedsReviewItem {
  speaker: string;
  start_time: number;
  confidence: number;
}

interface BackendJob {
  job_id: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  dialogue_entries: BackendDialogueEntry[] | null;
  accuracy: BackendAccuracy | null;
  needs_review: BackendNeedsReviewItem[] | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

interface BackendJobList {
  jobs: BackendJob[];
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

function toWords(
  words: BackendWordInfo[] | null | undefined
): Word[] | undefined {
  if (!words || words.length === 0) return undefined;
  return words.map((w) => ({
    text: w.text,
    startTime: w.start_time,
    endTime: w.end_time,
    confidence: w.confidence,
  }));
}

function toSegments(
  entries: BackendDialogueEntry[] | null
): TranscriptSegment[] | undefined {
  if (!entries || entries.length === 0) return undefined;
  return entries.map((entry, index) => ({
    id: `seg-${index}`,
    // The backend already labels speakers (e.g. "Speaker 1") via
    // add_speaker_labels — prefixing again here produced "Speaker Speaker 1".
    speaker: entry.speaker,
    speakerColor: colorForSpeaker(entry.speaker),
    text: entry.text,
    correctedText: entry.corrected_text ?? undefined,
    startTime: entry.start_time,
    duration: Math.max(0, entry.end_time - entry.start_time),
    confidence: entry.confidence ?? undefined,
    words: toWords(entry.words),
  }));
}

function toAccuracy(
  accuracy: BackendAccuracy | null
): TranscriptAccuracy | undefined {
  if (!accuracy) return undefined;
  return {
    confidenceScore: accuracy.confidence_score,
    wordsTranscribed: accuracy.words_transcribed,
    lowConfidenceCount: accuracy.low_confidence_count,
    confidenceThreshold: accuracy.confidence_threshold,
    hasCorrections: accuracy.has_corrections,
    wordErrorRate: accuracy.word_error_rate ?? undefined,
    correctedPercent: accuracy.corrected_percent ?? undefined,
  };
}

function toLowConfidenceSegments(
  items: BackendNeedsReviewItem[] | null
): LowConfidenceSegment[] | undefined {
  if (!items || items.length === 0) return undefined;
  return items.map((item) => ({
    speaker: item.speaker,
    speakerColor: colorForSpeaker(item.speaker),
    confidence: item.confidence,
    startTime: item.start_time,
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
    errorMessage: job.error_message ?? undefined,
    segments: toSegments(job.dialogue_entries),
    accuracy: toAccuracy(job.accuracy),
    lowConfidenceSegments: toLowConfidenceSegments(job.needs_review),
  };
}

export async function listJobs(): Promise<TranscriptionJob[]> {
  const response = await backendFetch("/api/v1/jobs");
  const body: BackendJobList = await response.json();
  return body.jobs.map(toTranscriptionJob);
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

export async function getJobAudio(
  jobId: string,
  rangeHeader?: string | null
): Promise<Response | null> {
  try {
    return await backendFetch(`/api/v1/jobs/${jobId}/audio`, {
      headers: rangeHeader ? { Range: rangeHeader } : undefined,
    });
  } catch (err) {
    if (err instanceof BackendApiError && err.status === 404) {
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
  metadata: SubmitJobMetadata,
  blobName?: string
): Promise<TranscriptionJob> {
  const response = await backendFetch("/api/v1/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_url: audioUrl,
      blob_name: blobName,
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

export async function correctSegment(
  jobId: string,
  index: number,
  correctedText: string
): Promise<TranscriptionJob> {
  const response = await backendFetch(
    `/api/v1/jobs/${jobId}/segments/${index}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corrected_text: correctedText }),
    }
  );
  const body: BackendJob = await response.json();
  return toTranscriptionJob(body);
}

export async function uploadAndSubmit(
  file: Blob,
  filename: string
): Promise<TranscriptionJob> {
  const { audio_url, blob_name } = await uploadAudio(file, filename);
  const caseReference = filename.replace(/\.[^.]+$/, "").replace(/_/g, "/");
  return submitJob(
    audio_url,
    {
      caseReference,
      tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
      audioFileName: filename,
    },
    blob_name
  );
}
