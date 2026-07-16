"use client";

import { Progress } from "@/components/ui/progress";
import {
  audioDurationMessage,
  computeElapsedSeconds,
  estimateRemainingSeconds,
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
  const remainingSeconds =
    elapsedSeconds !== null
      ? estimateRemainingSeconds({
          elapsedSeconds,
          progressPercent: job.progressPercent,
          audioDurationSeconds: job.audioDurationSeconds,
        })
      : undefined;
  const durationMessage = audioDurationMessage(job.audioDurationSeconds);

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {job.progressPercent !== undefined && (
        <div
          className={`flex items-center gap-3 ${compact ? "w-fit" : "max-w-sm"}`}
        >
          <Progress
            value={job.progressPercent}
            className={compact ? "w-24" : "flex-1"}
          />
          <span
            className={`text-muted-foreground tabular-nums ${compact ? "text-xs" : "text-sm"}`}
          >
            {job.progressPercent}%
          </span>
        </div>
      )}
      <p className={`text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
        {durationMessage && <span>{durationMessage}. </span>}
        {elapsedSeconds !== null && (
          <span>Elapsed: {formatDuration(elapsedSeconds)}</span>
        )}
        {remainingSeconds !== undefined && (
          <span>
            {" "}
            · Estimated remaining: {formatDuration(remainingSeconds)}
          </span>
        )}
      </p>
    </div>
  );
}
