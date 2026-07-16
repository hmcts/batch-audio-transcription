import type { CorrectionEntry, TranscriptionJob } from "./types";

// Human-readable label for a correction_history entry's `kind`. Shared
// between the per-segment history panel and the job-level modification
// history table so both name the same action identically.
export function historyKindLabel(kind: string): string {
  switch (kind) {
    case "segment":
      return "Whole-segment edit";
    case "word_range":
      return "Phrase correction";
    case "rollback":
      return "Rolled back";
    case "accept_all":
      return "Accepted as-is";
    default:
      return kind;
  }
}

// One modification action, flattened out of a single segment's
// correction_history and enriched with which segment it belongs to and who
// made it — so the whole transcript's edit history can be scanned in one
// table rather than segment by segment.
export interface ModificationHistoryRow {
  // ISO 8601 timestamp of when the action was taken.
  timestamp: string;
  // 0-based index of the segment in job.segments.
  segmentIndex: number;
  // 1-based, human-facing segment number (segmentIndex + 1).
  segmentNumber: number;
  speaker: string;
  // Start time (seconds) of the segment the action was taken on — lets the
  // table show a familiar transcript timestamp for the segment.
  segmentStartTime: number;
  kind: CorrectionEntry["kind"];
  // Concise before/after: the changed phrase for word-range corrections,
  // otherwise the whole-segment text. Equal for "accept_all" (nothing
  // changed — the clerk only confirmed the text as-is).
  before: string;
  after: string;
  // Who made the change. Job-level attribution (the caller that owns the
  // job): the audit trail records no per-action identity, so this is the
  // same for every row of a given job. Undefined if the backend didn't
  // report a caller.
  changedBy?: string;
}

function toEpoch(timestamp: string): number {
  const t = Date.parse(timestamp);
  // Unparseable timestamps sort last (treated as oldest) rather than
  // throwing NaN comparisons into the sort.
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

// Flattens correction_history across every segment of a job into a single
// list, ordered newest action first. Ties (identical timestamps — several
// actions can land in the same second) fall back to segment order, then to
// the order the entries were appended within the segment, so the result is
// deterministic. Returns [] when the job has no segments or no recorded
// actions.
export function buildModificationHistory(
  job: TranscriptionJob
): ModificationHistoryRow[] {
  const rows: {
    row: ModificationHistoryRow;
    entryIndex: number;
  }[] = [];

  job.segments?.forEach((segment, segmentIndex) => {
    segment.correctionHistory?.forEach((entry, entryIndex) => {
      rows.push({
        entryIndex,
        row: {
          timestamp: entry.timestamp,
          segmentIndex,
          segmentNumber: segmentIndex + 1,
          speaker: segment.speaker,
          segmentStartTime: segment.startTime,
          kind: entry.kind,
          before: entry.previousPhrase ?? entry.previousText,
          after: entry.newPhrase ?? entry.newText,
          changedBy: job.caller,
        },
      });
    });
  });

  rows.sort((a, b) => {
    const byTime = toEpoch(b.row.timestamp) - toEpoch(a.row.timestamp);
    if (byTime !== 0) return byTime;
    if (a.row.segmentIndex !== b.row.segmentIndex) {
      return a.row.segmentIndex - b.row.segmentIndex;
    }
    return a.entryIndex - b.entryIndex;
  });

  return rows.map((r) => r.row);
}
