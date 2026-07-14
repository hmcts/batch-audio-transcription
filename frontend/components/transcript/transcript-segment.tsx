"use client";

import {
  AlertTriangle,
  Check,
  History,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { confidencePercent, formatTime } from "@/lib/mock-data";
import type { TranscriptSegment as TranscriptSegmentType } from "@/lib/types";
import { cn } from "@/lib/utils";

const LOW_CONFIDENCE_THRESHOLD = 0.85;

type WordList = NonNullable<TranscriptSegmentType["words"]>;
type WordCorrectionList = NonNullable<TranscriptSegmentType["wordCorrections"]>;

interface OriginalRun {
  kind: "original";
  start: number;
  end: number; // inclusive
  lowConfidence: boolean;
}

interface CorrectedRun {
  kind: "corrected";
  start: number; // inclusive, indices into the original words array
  end: number; // inclusive
  text: string;
}

type Run = OriginalRun | CorrectedRun;

// Groups words[from..to] (inclusive) into runs of consecutive
// below/above-threshold confidence.
function groupByConfidence(
  words: WordList,
  from: number,
  to: number
): OriginalRun[] {
  const runs: OriginalRun[] = [];
  for (let i = from; i <= to; i++) {
    const lowConfidence = words[i].confidence < LOW_CONFIDENCE_THRESHOLD;
    const last = runs[runs.length - 1];
    if (last && last.lowConfidence === lowConfidence) {
      last.end = i;
    } else {
      runs.push({ kind: "original", start: i, end: i, lowConfidence });
    }
  }
  return runs;
}

// Splices active word_corrections into the original word list so untouched
// words keep rendering with their real per-word confidence/timing, while
// corrected ranges render as a single replacement span.
function buildRuns(
  words: WordList,
  corrections: WordCorrectionList | undefined
): Run[] {
  const sorted = [...(corrections ?? [])].sort(
    (a, b) => a.startWordIndex - b.startWordIndex
  );
  const runs: Run[] = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.startWordIndex > cursor) {
      runs.push(...groupByConfidence(words, cursor, c.startWordIndex - 1));
    }
    runs.push({
      kind: "corrected",
      start: c.startWordIndex,
      end: c.endWordIndex,
      text: c.text,
    });
    cursor = c.endWordIndex + 1;
  }
  if (cursor < words.length) {
    runs.push(...groupByConfidence(words, cursor, words.length - 1));
  }
  return runs;
}

interface WordsProps {
  words: WordList;
  wordCorrections?: WordCorrectionList;
  isActive?: boolean;
  getCurrentTime?: () => number;
  // Corrects just the clicked run (a low-confidence phrase, or an existing
  // correction being re-edited) — indices always refer to positions in the
  // original `words` array, so everything outside the range keeps its own
  // confidence/timing untouched.
  onCorrectRange?: (
    startWordIndex: number,
    endWordIndex: number,
    correctedText: string
  ) => Promise<void> | void;
  // Set while hovering a history entry, so its word range can be
  // highlighted here to show the clerk exactly where that change landed.
  highlightRange?: { start: number; end: number } | null;
}

function Words({
  words,
  wordCorrections,
  isActive,
  getCurrentTime,
  onCorrectRange,
  highlightRange,
}: WordsProps) {
  // The <audio> element's timeupdate event only fires a few times a
  // second — too coarse to track individual words, some of which are
  // shorter than the gap between events. Polling the real playback
  // position every animation frame instead keeps the highlight in sync
  // regardless of word length.
  const [liveTime, setLiveTime] = useState(0);
  const [editingRun, setEditingRun] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [rangeDraft, setRangeDraft] = useState("");
  const [savingRange, setSavingRange] = useState(false);

  useEffect(() => {
    if (!isActive || !getCurrentTime) return;
    let frame: number;
    const tick = () => {
      setLiveTime(getCurrentTime());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isActive, getCurrentTime]);

  const startEditingRun = (start: number, end: number, initialText: string) => {
    setRangeDraft(initialText);
    setEditingRun({ start, end });
  };

  const saveRun = async () => {
    if (!editingRun) return;
    const trimmed = rangeDraft.trim();
    if (!trimmed) {
      setEditingRun(null);
      return;
    }
    setSavingRange(true);
    try {
      await onCorrectRange?.(editingRun.start, editingRun.end, trimmed);
      setEditingRun(null);
    } finally {
      setSavingRange(false);
    }
  };

  if (editingRun) {
    const before = words
      .slice(0, editingRun.start)
      .map((w) => w.text)
      .join(" ");
    const after = words
      .slice(editingRun.end + 1)
      .map((w) => w.text)
      .join(" ");
    return (
      <div className="space-y-2">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {before && <>{before} </>}
          <input
            value={rangeDraft}
            onChange={(e) => setRangeDraft(e.target.value)}
            className="inline-block w-auto min-w-32 text-sm text-foreground border border-primary rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary"
            // biome-ignore lint/a11y/noAutofocus: opening the editor is an explicit user action
            autoFocus
          />
          {after && <> {after}</>}
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={saveRun} disabled={savingRange}>
            <Check className="size-3.5" />
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditingRun(null)}
            disabled={savingRange}
          >
            <X className="size-3.5" />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const runs = buildRuns(words, wordCorrections);

  return (
    <p className="text-sm leading-relaxed">
      {runs.map((run) => {
        const overlapsHighlight =
          !!highlightRange &&
          run.start <= highlightRange.end &&
          run.end >= highlightRange.start;

        if (run.kind === "corrected") {
          const isSpoken =
            isActive &&
            liveTime >= words[run.start].startTime &&
            liveTime < words[run.end].endTime;
          return (
            <span
              key={`corrected-${run.start}`}
              onClick={
                onCorrectRange
                  ? () => startEditingRun(run.start, run.end, run.text)
                  : undefined
              }
              onKeyDown={
                onCorrectRange
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        startEditingRun(run.start, run.end, run.text);
                      }
                    }
                  : undefined
              }
              role={onCorrectRange ? "button" : undefined}
              tabIndex={onCorrectRange ? 0 : undefined}
              title={
                onCorrectRange ? "Click to edit this correction" : undefined
              }
              className={cn(
                "rounded bg-emerald-100 text-emerald-900",
                isSpoken && "bg-primary/30",
                onCorrectRange && "cursor-pointer hover:bg-emerald-200",
                overlapsHighlight && "ring-2 ring-amber-500"
              )}
            >
              {run.text}{" "}
            </span>
          );
        }

        const runWords = words
          .slice(run.start, run.end + 1)
          .map((word, offset) => {
            const i = run.start + offset;
            const isSpoken =
              isActive && liveTime >= word.startTime && liveTime < word.endTime;
            const isHighlighted =
              !!highlightRange &&
              i >= highlightRange.start &&
              i <= highlightRange.end;
            return (
              <span
                key={i}
                className={cn(
                  "rounded",
                  isSpoken && "bg-primary/30",
                  isHighlighted && "ring-2 ring-amber-500"
                )}
              >
                {word.text}{" "}
              </span>
            );
          });

        if (!run.lowConfidence) return runWords;

        const initialText = words
          .slice(run.start, run.end + 1)
          .map((w) => w.text)
          .join(" ");

        return (
          <span
            key={run.start}
            onClick={
              onCorrectRange
                ? () => startEditingRun(run.start, run.end, initialText)
                : undefined
            }
            onKeyDown={
              onCorrectRange
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      startEditingRun(run.start, run.end, initialText);
                    }
                  }
                : undefined
            }
            role={onCorrectRange ? "button" : undefined}
            tabIndex={onCorrectRange ? 0 : undefined}
            title={
              onCorrectRange
                ? "Click to correct this low-confidence phrase"
                : undefined
            }
            className={cn(
              "rounded bg-orange-100 text-orange-900",
              onCorrectRange && "cursor-pointer hover:bg-orange-200"
            )}
          >
            {runWords}
          </span>
        );
      })}
    </p>
  );
}

function historyKindLabel(kind: string): string {
  switch (kind) {
    case "segment":
      return "Whole-segment edit";
    case "word_range":
      return "Phrase correction";
    case "rollback":
      return "Rolled back";
    default:
      return kind;
  }
}

interface HistoryPanelProps {
  history: NonNullable<TranscriptSegmentType["correctionHistory"]>;
  hasCorrections: boolean;
  onRollback?: () => Promise<void> | void;
  onRollbackToHistory?: (historyIndex: number) => Promise<void> | void;
  // Lets the transcript text highlight exactly where a hovered entry's
  // change landed.
  onHoverRange?: (range: { start: number; end: number } | null) => void;
}

function HistoryPanel({
  history,
  hasCorrections,
  onRollback,
  onRollbackToHistory,
  onHoverRange,
}: HistoryPanelProps) {
  const [pendingIndex, setPendingIndex] = useState<number | "all" | null>(null);

  const rollbackAll = async () => {
    setPendingIndex("all");
    try {
      await onRollback?.();
    } finally {
      setPendingIndex(null);
    }
  };

  const rollbackTo = async (index: number) => {
    setPendingIndex(index);
    try {
      await onRollbackToHistory?.(index);
    } finally {
      setPendingIndex(null);
    }
  };

  return (
    <div className="mt-2 border border-border rounded-md bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">
          Change history
        </p>
        {hasCorrections && onRollback && (
          <Button
            size="sm"
            variant="ghost"
            onClick={rollbackAll}
            disabled={pendingIndex !== null}
          >
            <RotateCcw className="size-3.5" />
            Roll back whole section
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {history.map((entry, index) => (
          <li
            key={`${entry.timestamp}-${index}`}
            className="text-xs border-t border-border pt-2 first:border-t-0 first:pt-0"
            onMouseEnter={
              entry.startWordIndex !== undefined &&
              entry.endWordIndex !== undefined
                ? () =>
                    onHoverRange?.({
                      start: entry.startWordIndex as number,
                      end: entry.endWordIndex as number,
                    })
                : undefined
            }
            onMouseLeave={() => onHoverRange?.(null)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {historyKindLabel(entry.kind)}
              </span>
              {onRollbackToHistory && (
                <button
                  type="button"
                  onClick={() => rollbackTo(index)}
                  disabled={pendingIndex !== null}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  Roll back to before this
                </button>
              )}
            </div>
            <p className="text-muted-foreground mt-0.5">
              <span className="line-through">
                {entry.previousPhrase ?? entry.previousText}
              </span>
              {" → "}
              <span className="text-foreground">
                {entry.newPhrase ?? entry.newText}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType;
  onSeek?: (time: number) => void;
  onCorrect?: (correctedText: string) => Promise<void> | void;
  onCorrectRange?: (
    startWordIndex: number,
    endWordIndex: number,
    correctedText: string
  ) => Promise<void> | void;
  onRollback?: () => Promise<void> | void;
  onRollbackToHistory?: (historyIndex: number) => Promise<void> | void;
  isActive?: boolean;
  // Reads live audio position on demand — only polled (via rAF) while
  // isActive, to highlight the word currently being spoken in sync with
  // playback without waiting on the coarser timeupdate event.
  getCurrentTime?: () => number;
}

export function TranscriptSegment({
  segment,
  onSeek,
  onCorrect,
  onCorrectRange,
  onRollback,
  onRollbackToHistory,
  isActive,
  getCurrentTime,
}: TranscriptSegmentProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(segment.correctedText ?? segment.text);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [highlightRange, setHighlightRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const pct =
    segment.confidence !== undefined
      ? confidencePercent(segment.confidence)
      : undefined;
  const isLowConf = pct !== undefined && pct < 85;
  const displayText = segment.correctedText ?? segment.text;
  const hasCorrections =
    segment.correctedText !== undefined ||
    (segment.wordCorrections?.length ?? 0) > 0;
  const hasHistory = (segment.correctionHistory?.length ?? 0) > 0;

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
          className={cn(
            "text-xs font-mono text-primary",
            onSeek && "hover:underline cursor-pointer"
          )}
          onClick={onSeek ? () => onSeek(segment.startTime) : undefined}
          onKeyDown={
            onSeek
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSeek(segment.startTime);
                  }
                }
              : undefined
          }
          role={onSeek ? "button" : undefined}
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
          {hasCorrections && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
              Edited
            </span>
          )}
          {hasHistory && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-label="Show change history"
              className={cn(
                "text-muted-foreground hover:text-foreground",
                !onCorrect && "ml-auto"
              )}
            >
              <History className="size-3.5" />
            </button>
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
          <Words
            words={segment.words}
            wordCorrections={segment.wordCorrections}
            isActive={isActive}
            getCurrentTime={getCurrentTime}
            onCorrectRange={onCorrectRange}
            highlightRange={highlightRange}
          />
        ) : (
          <p className="text-sm leading-relaxed">{displayText}</p>
        )}

        {showHistory && segment.correctionHistory && (
          <HistoryPanel
            history={segment.correctionHistory}
            hasCorrections={hasCorrections}
            onRollback={onRollback}
            onRollbackToHistory={onRollbackToHistory}
            onHoverRange={setHighlightRange}
          />
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
