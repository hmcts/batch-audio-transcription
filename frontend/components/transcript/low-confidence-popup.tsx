"use client";

import { confidencePercent } from "@/lib/mock-data";
import type { NBestCandidate } from "@/lib/types";

interface LowConfidencePopupProps {
  // Links the popup to the word/phrase via aria-describedby.
  id: string;
  // The hovered word/phrase's own confidence (0-1), or null when unavailable.
  confidence: number | null;
  // Alternate whole-phrase readings Azure also heard — already candidates[1:]
  // from the matching group (see diagnoseLowConfidenceWord). Empty when Azure
  // offered no alternatives, in which case the popup degrades to just the
  // confidence score plus a short explanation.
  alternativeCandidates: NBestCandidate[];
}

// Purely informational hover popup shown over a low-confidence word/phrase,
// explaining why Azure flagged it (DIAAT-233). It renders inside the
// interactive <span> (which itself lives inside a <p>), so it must contain
// only phrasing content — spans only, no block-level elements.
//
// `pointer-events-none` keeps it strictly informational: it never intercepts
// the click that opens the correction editor, and it holds no focusable
// content, so it cannot trap keyboard focus. Visibility is driven entirely by
// the parent's hover/focus state, so it dismisses cleanly on mouse-out/blur.
export function LowConfidencePopup({
  id,
  confidence,
  alternativeCandidates,
}: LowConfidencePopupProps) {
  const hasAlternatives = alternativeCandidates.length > 0;

  return (
    <span
      id={id}
      role="tooltip"
      className="pointer-events-none absolute left-0 top-full z-20 mt-1 block w-64 whitespace-normal rounded-md border border-border bg-popover p-3 text-left text-xs font-normal normal-case text-popover-foreground shadow-md"
    >
      <span className="block font-semibold text-foreground">
        Low confidence
      </span>
      <span className="mt-1 block text-muted-foreground">
        {confidence !== null
          ? `Azure's confidence here is ${confidencePercent(confidence)}%.`
          : "Azure flagged this as uncertain."}
      </span>

      {hasAlternatives ? (
        <span className="mt-2 block">
          <span className="block font-medium text-foreground">
            Azure also heard
          </span>
          <span className="mt-1 block">
            {alternativeCandidates.map((candidate, index) => (
              <span
                // Candidate text can repeat across nBest entries, so include
                // the index to keep keys stable/unique.
                key={`${candidate.text}-${index}`}
                className="mt-1 flex items-baseline justify-between gap-2 first:mt-0"
              >
                <span className="text-foreground">
                  &ldquo;{candidate.text}&rdquo;
                </span>
                {candidate.confidence !== undefined && (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {confidencePercent(candidate.confidence)}%
                  </span>
                )}
              </span>
            ))}
          </span>
        </span>
      ) : (
        <span className="mt-2 block text-muted-foreground">
          Azure suggested no alternative readings. Check the highlighted text
          against the audio.
        </span>
      )}
    </span>
  );
}
