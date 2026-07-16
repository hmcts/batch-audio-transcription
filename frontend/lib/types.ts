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

// One alternate whole-phrase reading Azure returned for a recognised
// phrase (an entry in its nBest array). Azure exposes alternatives only at
// the phrase level, never per word (DIAAT-232 spike) — so each candidate is
// a complete re-reading of the phrase, not a single-word swap. `text` is the
// display form (British-spelling-normalised); `confidence` is this reading's
// own score (0-1) and is sometimes absent on non-top candidates; `lexical`
// is the raw, unformatted recognition form when present.
export interface NBestCandidate {
  text: string;
  confidence?: number;
  lexical?: string;
}

// The nBest alternatives for one recognised phrase, persisted by DIAAT-232.
// `candidates[0]` is the reading already shown as the segment text (Azure's
// top choice) and is authoritative for ordering — never re-sort candidates.
// The optional inclusive [startWordIndex, endWordIndex] locates which words
// of this entry the group covers, in the same lexical `words` index space as
// WordCorrection; it is undefined when speaker-turn merging lost the word
// alignment (the candidates are still kept — see the DIAAT-232 spike).
export interface PhraseAlternatives {
  startWordIndex?: number;
  endWordIndex?: number;
  candidates: NBestCandidate[];
}

// One logged change to a segment's text — part of an append-only audit
// trail. A "rollback" is just another entry (kind "rollback") rather than
// a destructive edit, so the full history always stays visible. An
// "accept_all" entry means a clerk confirmed the segment's text is correct
// as transcribed without editing it — previousText/newText are identical.
export interface CorrectionEntry {
  timestamp: string;
  kind: "segment" | "word_range" | "rollback" | "accept_all";
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
  // Azure's nBest alternate readings for the phrase(s) in this entry
  // (DIAAT-232). One group per original phrase; used to explain why a
  // low-confidence word was flagged and, in DIAAT-234, to offer alternate
  // readings. Undefined when Azure returned only the top reading.
  alternatives?: PhraseAlternatives[];
  // Set once a clerk clicks "accept" to confirm this segment's text is
  // correct as transcribed, without editing it. Clears the segment from
  // "needs review" but — unlike correctedText/wordCorrections — never
  // affects the word-error-rate calculation, since nothing was corrected.
  accepted?: boolean;
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
  // True once a clerk has uploaded an independent reference transcript
  // (e.g. a court reporter's transcript). Unlike wordErrorRate above, this
  // WER is measured against the *entire* auto-generated transcription and
  // is unaffected by any corrections made in this app.
  hasBaseline: boolean;
  baselineWordErrorRate?: number;
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
  // The caller (API client / clerk identity) that owns this job. Every
  // correction is made under this caller, so it's the "who made the change"
  // attribution for the modification-history table. Job-level, not
  // per-action: the audit trail records no separate identity per correction.
  // In local dev this is always "local-dev".
  caller?: string;
  // Run metadata (DIAAT-227) — surfaced on the dashboard via the file name,
  // on hover/click, without needing to open the transcript. audioDuration is
  // known as soon as the file is submitted; the other two are only known
  // once the job has actually completed.
  audioDurationSeconds?: number;
  transcriptionDurationSeconds?: number;
  // Raw Azure model.self URL / fallback label. Kept as the fallback the
  // popover shows when a resolved friendly name isn't available.
  modelIdentifier?: string;
  // Human-readable model name resolved server-side (DIAAT-243), e.g.
  // "Base model — en-GB". Preferred over modelIdentifier in the UI;
  // undefined for historical jobs or when resolution failed.
  modelDisplayName?: string;
}
