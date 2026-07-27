"use client";

import { Progress } from "@/components/ui/progress";
import {
  audioDurationMessage,
  computeElapsedSeconds,
  computeProcessingProgress,
  formatDuration,
} from "@/lib/progress";
import type { TranscriptionJob } from "@/lib/types";
import { useNow } from "@/lib/use-now";

interface JobProgressProps {
  job: TranscriptionJob;
  // Denser layout for the dashboard's jobs table, vs. the full job detail page.
  compact?: boolean;
}

export function JobProgress({ job, compact = false }: JobProgressProps) {
  // A shared clock (see lib/use-now.ts) advances the elapsed-time readout
  // roughly once a second — smoother than the 5s status polling — while every
  // JobProgress on the page reuses a single interval rather than one each.
  // `now` is null during SSR / the first hydration render; the time-based
  // readouts are added once the client takes over, avoiding a hydration
  // mismatch on server-rendered time.
  const now = useNow();

  const elapsedSeconds =
    now !== null ? computeElapsedSeconds(job.uploadedAt, now) : null;

  // The bar and the countdown are BOTH derived from this single time-based
  // model (DIAAT-244), so they can never disagree. It needs the live clock, so
  // it's only computed once the client has taken over (elapsedSeconds !== null)
  // — except COMPLETED, whose bar is a static 100% (elapsed is ignored by the
  // model) and can safely render on the server without a clock.
  const model =
    elapsedSeconds !== null || job.status === "COMPLETED"
      ? computeProcessingProgress({
          status: job.status,
          elapsedSeconds: elapsedSeconds ?? 0,
          audioDurationSeconds: job.audioDurationSeconds,
        })
      : null;

  const barPercent = model?.barPercent;
  const remainingSeconds = model?.remainingSeconds;
  const overrun = model?.overrun ?? false;
  const durationMessage = audioDurationMessage(job.audioDurationSeconds);

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {barPercent !== undefined && (
        <div
          className={`flex items-center gap-3 ${compact ? "w-fit" : "max-w-sm"}`}
        >
          <Progress
            value={barPercent}
            className={compact ? "w-24" : "flex-1"}
          />
          <span
            className={`text-muted-foreground tabular-nums ${compact ? "text-xs" : "text-sm"}`}
          >
            {barPercent}%
          </span>
        </div>
      )}
      {/* Only render the paragraph once there's something to show — avoids an
          empty <p> (and its vertical spacing) during SSR / the first hydration
          frame, when `now` is null and there may be no duration message. */}
      {(durationMessage || elapsedSeconds !== null) && (
        <p
          className={`text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}
        >
          {durationMessage && <span>{durationMessage}. </span>}
          {elapsedSeconds !== null && (
            <span>Elapsed: {formatDuration(elapsedSeconds)}</span>
          )}
          {model && !overrun && remainingSeconds !== undefined && (
            <span>
              {" "}
              · Estimated remaining: {formatDuration(remainingSeconds)}
            </span>
          )}
          {model && overrun && <span> · Taking longer than usual…</span>}
        </p>
      )}
    </div>
  );
}
