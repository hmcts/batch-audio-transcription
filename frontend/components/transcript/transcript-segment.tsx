"use client";

import {
  AlertTriangle,
  Check,
  History,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { confidencePercent, formatTime } from "@/lib/mock-data";
import type { TranscriptSegment as TranscriptSegmentType } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  alignWordsToDisplayTokens,
  type DisplayToken,
  displayRangeForWordRange,
} from "@/lib/word-alignment";

const LOW_CONFIDENCE_THRESHOLD = 0.85;

type WordList = NonNullable<TranscriptSegmentType["words"]>;
type WordCorrectionList = NonNullable<TranscriptSegmentType["wordCorrections"]>;

// Runs are expressed in DISPLAY TOKEN indices (positions in the
// alignWordsToDisplayTokens() output) — never in the underlying lexical
// `words` array indices, since what's rendered is the properly-formatted
// phrase text, not the raw per-word recognition tokens. Corrections are
// still submitted to the backend in lexical indices (wordStart/wordEnd),
// since that's what the original words array — and any existing
// WordCorrection this run came from — are keyed on.
interface OriginalRun {
  kind: "original";
  start: number; // inclusive, display token index
  end: number; // inclusive, display token index
  lowConfidence: boolean;
}

interface CorrectedRun {
  kind: "corrected";
  start: number; // inclusive, display token index
  end: number; // inclusive, display token index
  text: string;
  wordStart: number; // the underlying WordCorrection's own lexical range —
  wordEnd: number; // used to re-edit the exact same correction.
}

type Run = OriginalRun | CorrectedRun;

// Groups tokens[from..to] (inclusive) into runs of consecutive
// below/above-threshold confidence.
function groupByConfidence(
  tokens: DisplayToken[],
  from: number,
  to: number
): OriginalRun[] {
  const runs: OriginalRun[] = [];
  for (let i = from; i <= to; i++) {
    const lowConfidence = tokens[i].confidence < LOW_CONFIDENCE_THRESHOLD;
    const last = runs[runs.length - 1];
    if (last && last.lowConfidence === lowConfidence) {
      last.end = i;
    } else {
      runs.push({ kind: "original", start: i, end: i, lowConfidence });
    }
  }
  return runs;
}

// Splices active word_corrections (given in lexical word indices) into the
// display-token stream, so untouched tokens keep rendering with their own
// confidence/timing while corrected ranges render as a single replacement.
interface CorrectionRange {
  start: number; // display token index
  end: number; // display token index
  text: string;
  wordStart: number;
  wordEnd: number;
}

// Corrections are non-overlapping in *lexical* word indices (enforced by
// the backend), but a single display token can span many lexical words —
// so two otherwise-disjoint corrections can still map onto the same or
// touching display-token range. Merge those into one, rather than
// rendering duplicate/overlapping corrected spans for the same tokens.
function mergeOverlappingCorrectionRanges(
  ranges: CorrectionRange[]
): CorrectionRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: CorrectionRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
      last.wordStart = Math.min(last.wordStart, r.wordStart);
      last.wordEnd = Math.max(last.wordEnd, r.wordEnd);
      last.text = `${last.text} ${r.text}`;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

function buildRuns(
  tokens: DisplayToken[],
  corrections: WordCorrectionList | undefined
): Run[] {
  const correctionRanges = mergeOverlappingCorrectionRanges(
    (corrections ?? [])
      .map((c) => {
        const range = displayRangeForWordRange(
          tokens,
          c.startWordIndex,
          c.endWordIndex
        );
        return range
          ? {
              start: range.start,
              end: range.end,
              text: c.text,
              wordStart: c.startWordIndex,
              wordEnd: c.endWordIndex,
            }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
  );

  const runs: Run[] = [];
  let cursor = 0;
  for (const c of correctionRanges) {
    if (c.start > cursor) {
      runs.push(...groupByConfidence(tokens, cursor, c.start - 1));
    }
    runs.push({
      kind: "corrected",
      start: c.start,
      end: c.end,
      text: c.text,
      wordStart: c.wordStart,
      wordEnd: c.wordEnd,
    });
    cursor = c.end + 1;
  }
  if (cursor < tokens.length) {
    runs.push(...groupByConfidence(tokens, cursor, tokens.length - 1));
  }
  return runs;
}

interface WordsProps {
  text: string;
  words: WordList;
  wordCorrections?: WordCorrectionList;
  isActive?: boolean;
  getCurrentTime?: () => number;
  // Corrects just the clicked run (a low-confidence phrase, or an existing
  // correction being re-edited). Indices are always in the original lexical
  // `words` array, matching the backend's word-range correction contract.
  onCorrectRange?: (
    startWordIndex: number,
    endWordIndex: number,
    correctedText: string
  ) => Promise<void> | void;
  // Set while hovering a history entry (in lexical word indices), so its
  // range can be highlighted here to show the clerk exactly where that
  // change landed.
  highlightRange?: { start: number; end: number } | null;
}

function Words({
  text,
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
    start: number; // display token index
    end: number; // display token index
    wordStart: number; // lexical index to submit on save
    wordEnd: number;
  } | null>(null);
  const [rangeDraft, setRangeDraft] = useState("");
  const [savingRange, setSavingRange] = useState(false);

  const tokens = useMemo(
    () => alignWordsToDisplayTokens(text, words),
    [text, words]
  );

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

  const startEditingRun = (
    start: number,
    end: number,
    wordStart: number,
    wordEnd: number,
    initialText: string
  ) => {
    setRangeDraft(initialText);
    setEditingRun({ start, end, wordStart, wordEnd });
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
      await onCorrectRange?.(editingRun.wordStart, editingRun.wordEnd, trimmed);
      setEditingRun(null);
    } finally {
      setSavingRange(false);
    }
  };

  if (editingRun) {
    const before = tokens
      .slice(0, editingRun.start)
      .map((t) => t.text)
      .join(" ");
    const after = tokens
      .slice(editingRun.end + 1)
      .map((t) => t.text)
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

  const runs = buildRuns(tokens, wordCorrections);
  const highlightDisplayRange = highlightRange
    ? displayRangeForWordRange(tokens, highlightRange.start, highlightRange.end)
    : null;

  return (
    <p className="text-sm leading-relaxed">
      {runs.map((run) => {
        const overlapsHighlight =
          !!highlightDisplayRange &&
          run.start <= highlightDisplayRange.end &&
          run.end >= highlightDisplayRange.start;

        if (run.kind === "corrected") {
          const isSpoken =
            isActive &&
            liveTime >= tokens[run.start].startTime &&
            liveTime < tokens[run.end].endTime;
          return (
            <span
              key={`corrected-${run.wordStart}-${run.wordEnd}`}
              onClick={
                onCorrectRange
                  ? () =>
                      startEditingRun(
                        run.start,
                        run.end,
                        run.wordStart,
                        run.wordEnd,
                        run.text
                      )
                  : undefined
              }
              onKeyDown={
                onCorrectRange
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        startEditingRun(
                          run.start,
                          run.end,
                          run.wordStart,
                          run.wordEnd,
                          run.text
                        );
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

        const runTokens = tokens
          .slice(run.start, run.end + 1)
          .map((token, offset) => {
            const i = run.start + offset;
            const isSpoken =
              isActive &&
              liveTime >= token.startTime &&
              liveTime < token.endTime;
            const isHighlighted =
              !!highlightDisplayRange &&
              i >= highlightDisplayRange.start &&
              i <= highlightDisplayRange.end;
            return (
              <span
                key={i}
                className={cn(
                  "rounded",
                  isSpoken && "bg-primary/30",
                  isHighlighted && "ring-2 ring-amber-500"
                )}
              >
                {token.text}{" "}
              </span>
            );
          });

        if (!run.lowConfidence) return runTokens;

        const initialText = tokens
          .slice(run.start, run.end + 1)
          .map((t) => t.text)
          .join(" ");
        const wordStart = tokens[run.start].startWordIndex;
        const wordEnd = tokens[run.end].endWordIndex;

        return (
          <span
            key={run.start}
            onClick={
              onCorrectRange
                ? () =>
                    startEditingRun(
                      run.start,
                      run.end,
                      wordStart,
                      wordEnd,
                      initialText
                    )
                : undefined
            }
            onKeyDown={
              onCorrectRange
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      startEditingRun(
                        run.start,
                        run.end,
                        wordStart,
                        wordEnd,
                        initialText
                      );
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
            {runTokens}
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
            text={segment.text}
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
