"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface HoverPopoverProps {
  /** The element that opens the popover — typically the visible label/text. */
  trigger: React.ReactNode;
  /** Popover body content. */
  children: React.ReactNode;
  /** Accessible name for the trigger button (announced by screen readers). */
  ariaLabel: string;
  triggerClassName?: string;
  panelClassName?: string;
}

/**
 * A lightweight info popover that opens on hover *or* click/keyboard focus —
 * plain React state rather than a UI library, since it only needs to render
 * a small metadata card, not full positioning/portal machinery.
 *
 * Visibility is derived from two independent inputs — `hovering` (mouse over
 * the trigger/panel) and `pinned` (opened by an explicit click) — so the two
 * interaction modes compose instead of fighting: hovering shows it, moving
 * away hides it again *unless* a click has pinned it open. Clicking toggles
 * the pin, giving touch/keyboard users the same information as mouse users.
 */
export function HoverPopover({
  trigger,
  children,
  ariaLabel,
  triggerClassName,
  panelClassName,
}: HoverPopoverProps) {
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const open = hovering || pinned;

  return (
    <div
      ref={containerRef}
      className="relative inline-flex min-w-0"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        type="button"
        className={cn(
          "min-w-0 truncate text-left underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
          triggerClassName
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        onClick={(e) => {
          // Stops row-level onClick handlers (e.g. navigating to the
          // transcript) from firing when the user is just checking metadata.
          e.stopPropagation();
          setPinned((wasPinned) => !wasPinned);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setPinned(false);
            setHovering(false);
          }
        }}
        onBlur={(e) => {
          if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setPinned(false);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          // Reuse the trigger's descriptive name so screen readers announce
          // what the dialog is about (e.g. "Transcription run details for …").
          aria-label={ariaLabel}
          className={cn(
            "absolute left-0 top-full z-20 mt-2 w-64 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md",
            panelClassName
          )}
          // Clicking inside the panel shouldn't bubble up to the row either.
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  );
}
