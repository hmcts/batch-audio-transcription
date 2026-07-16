"use client";

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import {
  audioDurationMessage,
  computeElapsedSeconds,
  estimateRemainingSeconds,
  formatDuration,
} from "@/lib/progress";
import type { TranscriptionJob } from "@/lib/types";

// Ticks independently of the job-status polling interval (which is 5s and
// only refetches from the network) so the elapsed-time readout keeps moving
// smoothly between polls rather than jumping in 5s steps.
const TICK_INTERVAL_MS = 1000;

interface JobProgressProps {
  job: TranscriptionJob;
  // Denser layout for the dashboard's jobs table, vs. the full job detail page.
  compact?: boolean;
}

export function JobProgress({ job, compact = false }: JobProgressProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const elapsedSeconds = computeElapsedSeconds(job.uploadedAt, now);
  const remainingSeconds = estimateRemainingSeconds({
    elapsedSeconds,
    progressPercent: job.progressPercent,
    audioDurationSeconds: job.audioDurationSeconds,
  });
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
        <span>Elapsed: {formatDuration(elapsedSeconds)}</span>
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
