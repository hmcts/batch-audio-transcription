import { AlertTriangle } from "lucide-react";
import { confidencePercent, formatTime } from "@/lib/mock-data";
import type { TranscriptSegment as TranscriptSegmentType } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType;
  onSeek?: (time: number) => void;
}

export function TranscriptSegment({ segment, onSeek }: TranscriptSegmentProps) {
  const pct =
    segment.confidence !== undefined
      ? confidencePercent(segment.confidence)
      : undefined;
  const isLowConf = pct !== undefined && pct < 85;

  return (
    <div
      className={cn(
        "flex gap-4 py-4 border-b border-border last:border-b-0",
        segment.flaggedForReview && "bg-yellow-50"
      )}
    >
      {/* Timestamp */}
      <div className="w-14 shrink-0 text-right">
        <span
          className="text-xs font-mono text-primary hover:underline cursor-pointer"
          onClick={() => onSeek?.(segment.startTime)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onSeek?.(segment.startTime);
          }}
          role="button"
          tabIndex={onSeek ? 0 : undefined}
        >
          {formatTime(segment.startTime)}
        </span>
        <div className="text-xs text-muted-foreground">
          {Math.round(segment.duration)}s
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Speaker + confidence */}
        <div className="flex items-center gap-2 mb-1">
          <span
            className="inline-block w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: segment.speakerColor }}
          />
          <span className="font-semibold text-sm">{segment.speaker}</span>
          {pct !== undefined && (
            <span
              className={cn(
                "text-xs font-semibold px-1.5 py-0.5 rounded",
                isLowConf
                  ? "bg-orange-100 text-orange-800"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {pct}% CONF
            </span>
          )}
        </div>

        {/* Text */}
        <p className="text-sm leading-relaxed">{segment.text}</p>

        {/* Flagged */}
        {segment.flaggedForReview && (
          <div className="flex items-center gap-1 mt-1 text-xs text-yellow-700">
            <AlertTriangle className="size-3" />
            Flagged for clerk review
          </div>
        )}
      </div>
    </div>
  );
}
