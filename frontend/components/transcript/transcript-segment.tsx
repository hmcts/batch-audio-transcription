"use client";

import { AlertTriangle, Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { confidencePercent, formatTime } from "@/lib/mock-data";
import type { TranscriptSegment as TranscriptSegmentType } from "@/lib/types";
import { cn } from "@/lib/utils";

const LOW_CONFIDENCE_THRESHOLD = 0.85;

interface WordsProps {
  words: NonNullable<TranscriptSegmentType["words"]>;
  currentTime?: number;
}

function Words({ words, currentTime }: WordsProps) {
  return (
    <p className="text-sm leading-relaxed">
      {words.map((word, i) => {
        const isLowConf = word.confidence < LOW_CONFIDENCE_THRESHOLD;
        const isSpoken =
          currentTime !== undefined &&
          currentTime >= word.startTime &&
          currentTime < word.endTime;
        return (
          <span
            key={i}
            className={cn(
              "rounded",
              isSpoken
                ? "bg-primary/30"
                : isLowConf && "bg-orange-100 text-orange-900"
            )}
          >
            {word.text}{" "}
          </span>
        );
      })}
    </p>
  );
}

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType;
  onSeek?: (time: number) => void;
  onCorrect?: (correctedText: string) => Promise<void> | void;
  isActive?: boolean;
  // Live audio position — only meaningful while isActive, to highlight the
  // word currently being spoken in sync with playback.
  currentTime?: number;
}

export function TranscriptSegment({
  segment,
  onSeek,
  onCorrect,
  isActive,
  currentTime,
}: TranscriptSegmentProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(segment.correctedText ?? segment.text);
  const [saving, setSaving] = useState(false);

  const pct =
    segment.confidence !== undefined
      ? confidencePercent(segment.confidence)
      : undefined;
  const isLowConf = pct !== undefined && pct < 85;
  const displayText = segment.correctedText ?? segment.text;

  const startEditing = () => {
    setDraft(displayText);
    setEditing(true);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === displayText) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onCorrect?.(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      id={segment.id}
      className={cn(
        "flex gap-4 py-4 border-b border-border last:border-b-0 transition-colors scroll-mt-20",
        isActive && "bg-primary/5 border-l-2 border-l-primary -ml-0.5 pl-0.5",
        segment.flaggedForReview && !isActive && "bg-yellow-50"
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
          {segment.correctedText !== undefined && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
              Edited
            </span>
          )}
          {onCorrect && !editing && (
            <button
              type="button"
              onClick={startEditing}
              aria-label="Edit segment text"
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>

        {/* Text / edit form */}
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full text-sm leading-relaxed border border-border rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              // biome-ignore lint/a11y/noAutofocus: opening the editor is an explicit user action
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                <Check className="size-3.5" />
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                <X className="size-3.5" />
                Cancel
              </Button>
            </div>
          </div>
        ) : segment.correctedText === undefined && segment.words ? (
          <Words words={segment.words} currentTime={currentTime} />
        ) : (
          <p className="text-sm leading-relaxed">{displayText}</p>
        )}

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
