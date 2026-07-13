export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface Word {
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

export interface TranscriptSegment {
  id: string;
  speaker: string;
  speakerColor: string;
  text: string;
  // Set once a clerk edits this segment. The original `text` (what Speech
  // Batch actually produced) is preserved so a real word error rate can be
  // computed against it.
  correctedText?: string;
  startTime: number;
  duration: number;
  confidence?: number;
  flaggedForReview?: boolean;
  // Per-word timing/confidence for the original text — undefined once the
  // segment has been corrected (a clerk's freeform correction has no
  // per-word data), or if Azure didn't return word-level detail.
  words?: Word[];
}

export interface LowConfidenceSegment {
  speaker: string;
  speakerColor: string;
  confidence: number;
  startTime: number;
}

export interface TranscriptAccuracy {
  // Azure's own confidence score (0-100) — not a verified accuracy
  // measurement, since there's no human reference transcript yet.
  confidenceScore: number;
  wordsTranscribed: number;
  lowConfidenceCount: number;
  confidenceThreshold: number;
  // True once at least one segment has been corrected by a clerk — only
  // then does a real, reference-backed word error rate exist.
  hasCorrections: boolean;
  wordErrorRate?: number;
  correctedPercent?: number;
}

export interface TranscriptionJob {
  id: string;
  caseReference: string;
  tribunal: string;
  audioFileName: string;
  uploadedAt: string;
  completedAt?: string;
  status: JobStatus;
  progressPercent?: number;
  errorMessage?: string;
  segments?: TranscriptSegment[];
  accuracy?: TranscriptAccuracy;
  lowConfidenceSegments?: LowConfidenceSegment[];
}
