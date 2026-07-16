"use client";

import { useMemo } from "react";
import { formatTime } from "@/lib/mock-data";
import {
  buildModificationHistory,
  historyKindLabel,
  type ModificationHistoryRow,
} from "@/lib/modification-history";
import type { TranscriptionJob } from "@/lib/types";
import { cn } from "@/lib/utils";

// Colour-codes the action kind so a whole transcript's history can be
// scanned at a glance (edits green, rollbacks amber, accepts blue).
const KIND_CLASSES: Record<ModificationHistoryRow["kind"], string> = {
  segment: "bg-emerald-100 text-emerald-800",
  word_range: "bg-emerald-100 text-emerald-800",
  rollback: "bg-amber-100 text-amber-800",
  accept_all: "bg-blue-100 text-blue-800",
};

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface ModificationHistoryTableProps {
  job: TranscriptionJob;
  // Jumps the audio/transcript to a segment when its row is clicked.
  onSeekToSegment?: (startTime: number) => void;
}

export function ModificationHistoryTable({
  job,
  onSeekToSegment,
}: ModificationHistoryTableProps) {
  // Flatten + sort is O(n log n); memoise so frequent parent re-renders
  // (e.g. audio-position updates on the transcript page) don't re-sort a
  // potentially long transcript's whole history on every frame.
  const rows = useMemo(() => buildModificationHistory(job), [job]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center border border-border rounded-lg">
        No modifications have been made to this transcript yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">
              When
            </th>
            <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">
              Segment
            </th>
            <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">
              Action
            </th>
            <th className="px-4 py-3 text-left font-semibold">Change</th>
            <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">
              Changed by
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, index) => {
            const seekable = !!onSeekToSegment;
            const unchanged = row.before === row.after;
            return (
              <tr
                // Rows aren't uniquely identifiable by any single field (two
                // actions can share a timestamp+segment), so compose a key
                // from the position within the deterministically-sorted list.
                key={`${row.timestamp}-${row.segmentIndex}-${index}`}
                // Mouse convenience only — clicking anywhere on the row seeks.
                // Keyboard/assistive-tech users get a real <button> in the
                // segment cell instead (adding role/tabIndex to <tr> itself
                // would destroy its table-row semantics for the cells within).
                onClick={
                  seekable
                    ? () => onSeekToSegment(row.segmentStartTime)
                    : undefined
                }
                className={cn(
                  "align-top",
                  seekable &&
                    "cursor-pointer hover:bg-muted/30 transition-colors"
                )}
              >
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap tabular-nums">
                  {formatTimestamp(row.timestamp)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {seekable ? (
                    <button
                      type="button"
                      // Same seek as the row click; stop propagation so the
                      // row's onClick doesn't also fire (harmless, but avoids
                      // a duplicate seek call).
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeekToSegment(row.segmentStartTime);
                      }}
                      title="Jump to this segment"
                      className="font-medium text-primary hover:underline text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                    >
                      Segment {row.segmentNumber}
                    </button>
                  ) : (
                    <span className="font-medium">
                      Segment {row.segmentNumber}
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {row.speaker} · {formatTime(row.segmentStartTime)}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className={cn(
                      "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
                      KIND_CLASSES[row.kind]
                    )}
                  >
                    {historyKindLabel(row.kind)}
                  </span>
                </td>
                <td className="px-4 py-3 min-w-64">
                  {unchanged ? (
                    <span className="text-muted-foreground italic">
                      No text change
                    </span>
                  ) : (
                    <span>
                      <span className="line-through text-muted-foreground">
                        {row.before}
                      </span>
                      {" → "}
                      <span className="text-foreground">{row.after}</span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                  {row.changedBy ?? "Unknown"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
