// Pure helpers for the "richer" processing-job progress display: elapsed
// time since submission, an estimated time remaining, and a human-readable
// audio-duration message (e.g. "Transcribing 2h 36m of audio"). Kept free of
// React/DOM so they're trivial to unit test and can be reused by any
// component that renders a job's progress (the job detail page, the jobs
// table, etc).

// Azure Speech Batch transcription (with diarization) has been observed to
// typically complete well within the audio's own real-time duration. This
// ratio is only a starting estimate for "estimated remaining time" — once a
// job has run long enough to have a non-zero stage-based progress reading,
// the observed elapsed-vs-progress throughput is blended in alongside it (see
// estimateRemainingSeconds), so the estimate isn't solely a fixed multiple of
// audio duration.
const ASSUMED_PROCESSING_RATIO = 0.5;

/** Seconds elapsed between `submittedAt` (an ISO 8601 timestamp) and `now`. */
export function computeElapsedSeconds(submittedAt: string, now: Date): number {
  const submitted = new Date(submittedAt).getTime();
  if (Number.isNaN(submitted)) return 0;
  return Math.max(0, (now.getTime() - submitted) / 1000);
}

/**
 * Formats a duration in seconds as a short, human-readable string using
 * hours and minutes only (e.g. "2h 36m", "45m"), matching the style asked
 * for in the "Transcribing 2h 36m of audio" message. Durations under 30
 * seconds are rendered as "less than a minute" rather than rounding down to
 * a misleading "0m".
 */
export function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  if (clamped < 30) return "less than a minute";

  const totalMinutes = Math.round(clamped / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export interface EstimateRemainingInput {
  elapsedSeconds: number;
  // The stage-based progress percentage the backend/frontend currently
  // reports for the job (0-100).
  progressPercent?: number;
  audioDurationSeconds?: number;
}

/**
 * Estimates the remaining processing time in seconds, or undefined if there
 * isn't enough information yet. Combines two independent signals when both
 * are available, per DIAAT-226's acceptance criteria ("based on audio
 * duration and/or observed throughput"):
 *
 * - A duration-based estimate: audio duration scaled by
 *   ASSUMED_PROCESSING_RATIO, minus time already elapsed.
 * - A throughput-based estimate: projects the total processing time from
 *   how long it's taken to reach the current progress percentage, then
 *   returns the remaining portion of that projection.
 *
 * As elapsed time grows (each poll/tick), both components shrink, so the
 * returned estimate naturally updates as polling refreshes the job status.
 */
export function estimateRemainingSeconds({
  elapsedSeconds,
  progressPercent,
  audioDurationSeconds,
}: EstimateRemainingInput): number | undefined {
  const durationEstimate =
    audioDurationSeconds != null && audioDurationSeconds > 0
      ? Math.max(
          0,
          audioDurationSeconds * ASSUMED_PROCESSING_RATIO - elapsedSeconds
        )
      : undefined;

  const throughputEstimate =
    progressPercent != null && progressPercent > 0 && progressPercent < 100
      ? Math.max(
          0,
          (elapsedSeconds / progressPercent) * (100 - progressPercent)
        )
      : undefined;

  if (durationEstimate !== undefined && throughputEstimate !== undefined) {
    return (durationEstimate + throughputEstimate) / 2;
  }
  return durationEstimate ?? throughputEstimate;
}

/** "Transcribing 2h 36m of audio" — undefined if the duration isn't known. */
export function audioDurationMessage(
  audioDurationSeconds?: number
): string | undefined {
  if (audioDurationSeconds == null || audioDurationSeconds <= 0)
    return undefined;
  return `Transcribing ${formatDuration(audioDurationSeconds)} of audio`;
}
