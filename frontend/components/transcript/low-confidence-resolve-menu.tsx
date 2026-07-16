"use client";

import { ChevronRight, ListChecks, Pencil } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { confidencePercent } from "@/lib/mock-data";
import type { NBestCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";

interface LowConfidenceResolveMenuProps {
  // Links the menu to its trigger word/phrase via aria-controls/labelling.
  id: string;
  // Alternate whole-phrase readings Azure also heard — already candidates[1:]
  // from the matching group (see diagnoseLowConfidenceWord), NEVER re-sorted.
  // Rendered under "Suggested"; when empty the caller skips the menu entirely
  // and opens Edit directly, so this component always has at least one.
  candidates: NBestCandidate[];
  // True while a chosen candidate is being applied as a correction — disables
  // the options so the clerk can't fire a second correction mid-flight.
  applying: boolean;
  // Opens today's existing inline text box (Save/Cancel), unchanged.
  onEdit: () => void;
  // Applies the chosen candidate as a correction over the phrase's word-range,
  // exactly as typing that text into the inline editor would.
  onPickCandidate: (candidate: NBestCandidate) => void;
  // Dismisses the menu without taking any action (Escape / outside click).
  onClose: () => void;
}

// The click-to-resolve menu shown over a low-confidence word/phrase
// (DIAAT-234). Distinct from the informational hover popup (DIAAT-233):
// hover explains, click resolves. Offers two paths — "Edit" (today's inline
// text box) and "Suggested" (pick one of Azure's alternate readings) — and is
// keyboard-dismissable. Only rendered when at least one alternative exists.
export function LowConfidenceResolveMenu({
  id,
  candidates,
  applying,
  onEdit,
  onPickCandidate,
  onClose,
}: LowConfidenceResolveMenuProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);

  // Dismiss on Escape or a click outside the menu. The trigger word's own
  // click re-opens it (the parent owns that state), so this only needs to
  // handle "clerk moved on" — not toggling.
  useEffect(() => {
    // The trigger word is the menu's sibling (both live in the run's
    // positioning wrapper), so find it via the shared parent rather than an
    // ancestor lookup.
    const triggerEl = () =>
      menuRef.current?.parentElement?.querySelector<HTMLElement>(
        '[role="button"]'
      ) ?? null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        // Return focus to the trigger word before the menu unmounts, so a
        // keyboard user keeps their place in the transcript.
        triggerEl()?.focus();
        onClose();
      }
    };
    // pointerdown (not mousedown) so the menu also dismisses on touch/pen
    // input, which never emits mouse events. Treat a click on either the menu
    // or the trigger word as "inside" — clicking the word toggles the menu via
    // the trigger's own handler, so it must not also count as an outside click.
    const onPointerDown = (e: PointerEvent) => {
      const menuEl = menuRef.current;
      if (!menuEl) return;
      const target = e.target as Node;
      if (menuEl.contains(target)) return;
      if (triggerEl()?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  // Move focus into the menu on open so keyboard users land on the first
  // option instead of being stranded on the trigger word.
  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
      ?.focus();
  }, []);

  // Roving Arrow/Home/End navigation across whichever options are currently
  // visible (Edit, Suggested, and — when expanded — the candidate items).
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])'
      ) ?? []
    );
    if (items.length === 0) return;
    e.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = items.length - 1;
    } else if (e.key === "ArrowDown") {
      next = current < items.length - 1 ? current + 1 : 0;
    } else {
      next = current > 0 ? current - 1 : items.length - 1;
    }
    items[next]?.focus();
  };

  const suggestionsId = `${id}-suggestions`;

  return (
    <span
      ref={menuRef}
      id={id}
      role="menu"
      aria-label="Resolve low-confidence text"
      // Stop clicks inside the menu from bubbling back up to the trigger
      // word's own click handler (which would re-open the menu).
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onMenuKeyDown}
      className="absolute left-0 top-full z-30 mt-1 flex items-start whitespace-normal text-left text-xs font-normal normal-case"
    >
      <span className="block w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
        <button
          type="button"
          role="menuitem"
          disabled={applying}
          onClick={onEdit}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted disabled:opacity-50"
        >
          <Pencil className="size-3.5 shrink-0" />
          <span>Edit</span>
        </button>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={showSuggestions}
          // Only reference the submenu while it's actually rendered — it's
          // conditionally mounted, so a permanent aria-controls would dangle.
          aria-controls={showSuggestions ? suggestionsId : undefined}
          disabled={applying}
          onClick={() => setShowSuggestions((v) => !v)}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted disabled:opacity-50"
        >
          <ListChecks className="size-3.5 shrink-0" />
          <span className="flex-1">Suggested</span>
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              showSuggestions && "rotate-90"
            )}
          />
        </button>
      </span>

      {showSuggestions && (
        <span
          id={suggestionsId}
          role="menu"
          aria-label="Suggested alternatives"
          className="ml-1 block w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <span className="block px-2 py-1 font-medium text-muted-foreground">
            Azure also heard
          </span>
          {candidates.map((candidate, index) => (
            <button
              // Candidate text can repeat across nBest entries, so include the
              // index to keep keys stable/unique.
              key={`${candidate.text}-${index}`}
              type="button"
              role="menuitem"
              disabled={applying}
              onClick={() => onPickCandidate(candidate)}
              className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
            >
              <span className="text-foreground">
                &ldquo;{candidate.text}&rdquo;
              </span>
              {candidate.confidence !== undefined && (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {confidencePercent(candidate.confidence)}%
                </span>
              )}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
