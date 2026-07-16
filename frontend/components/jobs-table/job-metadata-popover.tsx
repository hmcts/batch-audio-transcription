"use client";

import { Info } from "lucide-react";
import { HoverPopover } from "@/components/ui/hover-popover";
import type { TranscriptionJob } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

interface JobMetadataPopoverProps {
  job: TranscriptionJob;
}

// Microsoft's PUBLIC Speech-to-Text docs (safe, unauthenticated) — NOT the
// authenticated model.self endpoint. Linked only when we're showing a
// resolved friendly name so a clerk can read what a base model is.
const SPEECH_MODELS_DOCS_URL =
  "https://learn.microsoft.com/azure/ai-services/speech-service/how-to-custom-speech-choose-model";

/** True once there's at least one piece of run metadata worth showing. */
export function hasRunMetadata(job: TranscriptionJob): boolean {
  return (
    job.audioDurationSeconds !== undefined ||
    job.transcriptionDurationSeconds !== undefined ||
    job.modelDisplayName !== undefined ||
    job.modelIdentifier !== undefined
  );
}

/**
 * Surfaces audio length, transcription processing time, and the model that
 * produced the transcript directly on the dashboard's file name — on hover
 * or click — so a clerk can check run details without opening the
 * transcript itself (DIAAT-227).
 */
export function JobMetadataPopover({ job }: JobMetadataPopoverProps) {
  // Transcription time and model are only known once the job succeeds. Show
  // "In progress…" while the job can still produce them, but a terminal
  // placeholder ("—") once it has reached a terminal state without them
  // (e.g. a FAILED job) — otherwise "In progress…" is misleading for a
  // value that will never arrive.
  const isTerminal = job.status === "COMPLETED" || job.status === "FAILED";
  const missingPlaceholder = isTerminal ? "—" : "In progress…";

  // Prefer the server-resolved human-readable name (e.g. "Base model —
  // en-GB"); fall back to the raw model_identifier for historical jobs or
  // when resolution failed, and finally to the progress/terminal placeholder.
  const modelLabel =
    job.modelDisplayName ?? job.modelIdentifier ?? missingPlaceholder;

  return (
    <HoverPopover
      ariaLabel={`Transcription run details for ${job.audioFileName}`}
      trigger={
        <span className="inline-flex items-center gap-1">
          <span className="truncate max-w-48">{job.audioFileName}</span>
          <Info className="size-3.5 shrink-0 text-muted-foreground" />
        </span>
      }
    >
      <dl className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Audio length</dt>
          <dd className="font-medium tabular-nums">
            {formatDuration(job.audioDurationSeconds)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Transcription time</dt>
          <dd className="font-medium tabular-nums">
            {job.transcriptionDurationSeconds !== undefined
              ? formatDuration(job.transcriptionDurationSeconds)
              : missingPlaceholder}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground shrink-0">Model</dt>
          <dd
            className="truncate font-medium"
            title={job.modelDisplayName ?? job.modelIdentifier ?? undefined}
          >
            {modelLabel}
          </dd>
        </div>
        {job.modelDisplayName !== undefined ? (
          <div className="flex justify-end">
            <a
              href={SPEECH_MODELS_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              About Speech models
            </a>
          </div>
        ) : null}
      </dl>
    </HoverPopover>
  );
}
