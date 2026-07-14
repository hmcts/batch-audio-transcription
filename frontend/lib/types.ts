export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface Word {
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

// An active replacement for a contiguous run of the *original* words.
// Indices always refer to positions in `words` (never renumbered), so
// multiple non-overlapping corrections can coexist while everything
// outside the corrected ranges still renders with its original per-word
// confidence/timing.
export interface WordCorrection {
  startWordIndex: number;
  endWordIndex: number; // inclusive
  text: string;
}

// One logged change to a segment's text — part of an append-only audit
// trail. A "rollback" is just another entry (kind "rollback") rather than
// a destructive edit, so the full history always stays visible.
export interface CorrectionEntry {
  timestamp: string;
  kind: "segment" | "word_range" | "rollback";
  // Whole-segment text before/after — always present, needed to restore
  // state on a "roll back to before this" action.
  previousText: string;
  newText: string;
  startWordIndex?: number;
  endWordIndex?: number;
  // Just the phrase that changed — set only for kind "word_range", so the
  // UI can show e.g. "quick" -> "slow" instead of the whole segment text.
  previousPhrase?: string;
  newPhrase?: string;
}

export interface TranscriptSegment {
  id: string;
  speaker: string;
  speakerColor: string;
  text: string;
  // Set once a clerk edits the whole segment via freeform text. The
  // original `text` (what Speech Batch actually produced) is preserved so
  // a real word error rate can be computed against it. Takes precedence
  // over wordCorrections when set.
  correctedText?: string;
  // Active, non-overlapping replacements for specific runs of the original
  // words — lets the UI keep showing per-word confidence/playback-sync
  // highlighting for everything the clerk hasn't touched.
  wordCorrections?: WordCorrection[];
  correctionHistory?: CorrectionEntry[];
  startTime: number;
  duration: number;
  confidence?: number;
  flaggedForReview?: boolean;
  // Per-word timing/confidence for the original text — undefined if Azure
  // didn't return word-level detail for this phrase.
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
