import "server-only";
import type {
  CorrectionEntry,
  JobStatus,
  LowConfidenceSegment,
  PhraseAlternatives,
  TranscriptAccuracy,
  TranscriptionJob,
  TranscriptSegment,
  Word,
  WordCorrection,
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

interface BackendWordCorrection {
  start_word_index: number;
  end_word_index: number;
  text: string;
}

interface BackendCorrectionEntry {
  timestamp: string;
  kind: string;
  previous_text: string;
  new_text: string;
  start_word_index?: number | null;
  end_word_index?: number | null;
  previous_phrase?: string | null;
  new_phrase?: string | null;
}

interface BackendNBestCandidate {
  text: string;
  confidence?: number | null;
  lexical?: string | null;
}

interface BackendPhraseAlternatives {
  start_word_index?: number | null;
  end_word_index?: number | null;
  candidates: BackendNBestCandidate[];
}

interface BackendDialogueEntry {
  speaker: string;
  text: string;
  start_time: number;
  end_time: number;
  confidence?: number | null;
  corrected_text?: string | null;
  word_corrections?: BackendWordCorrection[] | null;
  correction_history?: BackendCorrectionEntry[] | null;
  words?: BackendWordInfo[] | null;
  alternatives?: BackendPhraseAlternatives[] | null;
  accepted?: boolean;
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
  caller_name?: string | null;
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

// Raw fetch against the backend — returns the Response as-is regardless of
// status, so a caller that needs to forward non-2xx statuses verbatim (e.g.
// audio range requests, where 206/404/416 all need to reach the browser
// with their real status and headers intact) can do so without them being
// turned into a thrown error first. Most callers want backendFetch()
// instead, which throws on non-2xx for the common "this should always
// succeed" case.
async function rawBackendFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`${backendUrl()}${path}`, {
    ...init,
    // Authorization is spread last so a caller-supplied header (present or
    // future) can never accidentally override the backend bearer token.
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${apiKey()}`,
    },
    cache: "no-store",
  });
}

async function backendFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const response = await rawBackendFetch(path, init);

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

function toWordCorrections(
  corrections: BackendWordCorrection[] | null | undefined
): WordCorrection[] | undefined {
  if (!corrections || corrections.length === 0) return undefined;
  return corrections.map((c) => ({
    startWordIndex: c.start_word_index,
    endWordIndex: c.end_word_index,
    text: c.text,
  }));
}

function toCorrectionHistory(
  history: BackendCorrectionEntry[] | null | undefined
): CorrectionEntry[] | undefined {
  if (!history || history.length === 0) return undefined;
  return history.map((h) => ({
    timestamp: h.timestamp,
    kind: h.kind as CorrectionEntry["kind"],
    previousText: h.previous_text,
    newText: h.new_text,
    startWordIndex: h.start_word_index ?? undefined,
    endWordIndex: h.end_word_index ?? undefined,
    previousPhrase: h.previous_phrase ?? undefined,
    newPhrase: h.new_phrase ?? undefined,
  }));
}

function toAlternatives(
  alternatives: BackendPhraseAlternatives[] | null | undefined
): PhraseAlternatives[] | undefined {
  if (!alternatives || alternatives.length === 0) return undefined;
  return alternatives.map((group) => ({
    startWordIndex: group.start_word_index ?? undefined,
    endWordIndex: group.end_word_index ?? undefined,
    // Candidate order is Azure-authoritative (index 0 = top reading) — map
    // it through verbatim without re-sorting. `confidence` is genuinely
    // optional on non-top candidates, so preserve its absence as undefined
    // rather than coercing it to 0 (which would read as "0% confidence").
    candidates: group.candidates.map((c) => ({
      text: c.text,
      confidence: c.confidence ?? undefined,
      lexical: c.lexical ?? undefined,
    })),
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
    wordCorrections: toWordCorrections(entry.word_corrections),
    correctionHistory: toCorrectionHistory(entry.correction_history),
    startTime: entry.start_time,
    duration: Math.max(0, entry.end_time - entry.start_time),
    confidence: entry.confidence ?? undefined,
    words: toWords(entry.words),
    alternatives: toAlternatives(entry.alternatives),
    accepted: entry.accepted ?? false,
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
    caller: job.caller_name ?? undefined,
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

// Returns the backend's raw Response — including non-2xx ones (404 if the
// job/blob doesn't exist, 416 for an unsatisfiable range, etc.) — so the
// route handler can forward the real status, headers, and body straight to
// the browser rather than every non-2xx collapsing into a generic error.
export async function getJobAudio(
  jobId: string,
  rangeHeader?: string | null
): Promise<Response> {
  return rawBackendFetch(`/api/v1/jobs/${jobId}/audio`, {
    headers: rangeHeader ? { Range: rangeHeader } : undefined,
  });
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

export async function correctWordRange(
  jobId: string,
  index: number,
  startWordIndex: number,
  endWordIndex: number,
  correctedText: string
): Promise<TranscriptionJob> {
  const response = await backendFetch(
    `/api/v1/jobs/${jobId}/segments/${index}/words`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_word_index: startWordIndex,
        end_word_index: endWordIndex,
        corrected_text: correctedText,
      }),
    }
  );
  const body: BackendJob = await response.json();
  return toTranscriptionJob(body);
}

export async function rollbackSegment(
  jobId: string,
  index: number
): Promise<TranscriptionJob> {
  const response = await backendFetch(
    `/api/v1/jobs/${jobId}/segments/${index}/rollback`,
    { method: "POST" }
  );
  const body: BackendJob = await response.json();
  return toTranscriptionJob(body);
}

export async function acceptSegment(
  jobId: string,
  index: number
): Promise<TranscriptionJob> {
  const response = await backendFetch(
    `/api/v1/jobs/${jobId}/segments/${index}/accept`,
    { method: "POST" }
  );
  const body: BackendJob = await response.json();
  return toTranscriptionJob(body);
}

export async function rollbackToHistoryEntry(
  jobId: string,
  index: number,
  historyIndex: number
): Promise<TranscriptionJob> {
  const response = await backendFetch(
    `/api/v1/jobs/${jobId}/segments/${index}/history/${historyIndex}/rollback`,
    { method: "POST" }
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
