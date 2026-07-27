// Pure helpers for the "richer" processing-job progress display: elapsed
// time since submission, an estimated time remaining, and a human-readable
// audio-duration message (e.g. "Transcribing 2h 36m of audio"). Kept free of
// React/DOM so they're trivial to unit test and can be reused by any
// component that renders a job's progress (the job detail page, the jobs
// table, etc).

import type { JobStatus } from "./types";

// Azure Speech Batch transcription processes audio at roughly 5x real time.
// Microsoft's "Roughly estimate the latency" guidance defines a normalized
// latency as ProcessDuration − (AudioLength / 5); the factor 5 is that ~5x
// rate. So a job's expected processing time is the audio duration divided by
// this factor. Both the progress bar and the countdown are driven from this
// single estimate, so they can never disagree (DIAAT-244).
// https://learn.microsoft.com/en-us/azure/ai-services/speech-service/batch-transcription#roughly-estimate-the-latency
const AZURE_REALTIME_FACTOR = 5;

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

/**
 * The expected total processing time for a job, in seconds, from Azure's ~5x
 * real-time rate — the audio duration divided by AZURE_REALTIME_FACTOR.
 * Returns undefined when the audio duration isn't known (or is non-positive),
 * in which case there's no meaningful time-based estimate to show.
 */
export function estimatedProcessingSeconds(
  audioDurationSeconds?: number
): number | undefined {
  if (audioDurationSeconds == null || audioDurationSeconds <= 0)
    return undefined;
  return audioDurationSeconds / AZURE_REALTIME_FACTOR;
}

export interface ProcessingProgressInput {
  status: JobStatus;
  elapsedSeconds: number;
  audioDurationSeconds?: number;
}

export interface ProcessingProgress {
  // 0-100 for the bar; undefined when there's no meaningful bar to show
  // (processing with an unknown audio duration). 100 only when COMPLETED.
  barPercent: number | undefined;
  // Remaining seconds while processing with a known duration; undefined when
  // the duration is unknown, the job is terminal, or elapsed has overrun the
  // estimate.
  remainingSeconds: number | undefined;
  // Still processing but elapsed has passed the estimate (e.g. Azure queue
  // wait) — the UI shows "taking longer than usual" rather than a negative or
  // looping countdown.
  overrun: boolean;
}

/**
 * The single, unified progress model driving BOTH the bar and the countdown
 * (DIAAT-244). Grounded in Azure's ~5x processing rate (see
 * estimatedProcessingSeconds), so the bar percentage and the remaining time
 * are always two views of the same estimate and can never disagree.
 */
export function computeProcessingProgress({
  status,
  elapsedSeconds,
  audioDurationSeconds,
}: ProcessingProgressInput): ProcessingProgress {
  if (status === "COMPLETED") {
    return { barPercent: 100, remainingSeconds: undefined, overrun: false };
  }
  if (status === "FAILED") {
    // No misleading bar — the UI renders a failed state separately.
    return {
      barPercent: undefined,
      remainingSeconds: undefined,
      overrun: false,
    };
  }

  // PENDING or PROCESSING.
  const est = estimatedProcessingSeconds(audioDurationSeconds);
  if (est === undefined) {
    // Unknown duration -> indeterminate; the UI shows elapsed time only.
    return {
      barPercent: undefined,
      remainingSeconds: undefined,
      overrun: false,
    };
  }
  if (elapsedSeconds >= est) {
    // Past the estimate: hold near-complete rather than jumping to 100% or
    // showing a negative/looping countdown.
    return { barPercent: 99, remainingSeconds: undefined, overrun: true };
  }
  return {
    // Capped below 100 until the job actually completes.
    barPercent: Math.min(99, Math.round((elapsedSeconds / est) * 100)),
    remainingSeconds: Math.max(0, est - elapsedSeconds),
    overrun: false,
  };
}

/** "Transcribing 2h 36m of audio" — undefined if the duration isn't known. */
export function audioDurationMessage(
  audioDurationSeconds?: number
): string | undefined {
  if (audioDurationSeconds == null || audioDurationSeconds <= 0)
    return undefined;
  return `Transcribing ${formatDuration(audioDurationSeconds)} of audio`;
}
