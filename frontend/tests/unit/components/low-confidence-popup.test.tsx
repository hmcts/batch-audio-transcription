import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LowConfidencePopup } from "@/components/transcript/low-confidence-popup";
import type { NBestCandidate } from "@/lib/types";

describe("LowConfidencePopup", () => {
  it("has a tooltip role linked by the given id", () => {
    render(
      <LowConfidencePopup
        id="popup-1"
        confidence={0.5}
        alternativeCandidates={[]}
      />
    );
    const popup = screen.getByRole("tooltip");
    expect(popup.id).toBe("popup-1");
  });

  it("shows the word's confidence as a percentage", () => {
    render(
      <LowConfidencePopup
        id="popup-1"
        confidence={0.52}
        alternativeCandidates={[]}
      />
    );
    expect(screen.getByText(/52%/)).toBeDefined();
  });

  it("falls back to a generic message when confidence is null", () => {
    render(
      <LowConfidencePopup
        id="popup-1"
        confidence={null}
        alternativeCandidates={[]}
      />
    );
    expect(screen.getByText(/flagged this as uncertain/i)).toBeDefined();
  });

  it("shows a short explanation and no alternatives list when there are none", () => {
    render(
      <LowConfidencePopup
        id="popup-1"
        confidence={0.5}
        alternativeCandidates={[]}
      />
    );
    expect(
      screen.getByText(/suggested no alternative readings/i)
    ).toBeDefined();
    expect(screen.queryByText(/azure also heard/i)).toBeNull();
  });

  it("lists alternate readings under an 'Azure also heard' heading", () => {
    const candidates: NBestCandidate[] = [
      { text: "helloworld", confidence: 0.177 },
      { text: "hello worm", confidence: 0.5 },
    ];
    render(
      <LowConfidencePopup
        id="popup-1"
        confidence={0.56}
        alternativeCandidates={candidates}
      />
    );
    expect(screen.getByText(/azure also heard/i)).toBeDefined();
    expect(screen.getByText(/helloworld/)).toBeDefined();
    expect(screen.getByText(/hello worm/)).toBeDefined();
    // Each candidate renders its own confidence when present.
    expect(screen.getByText("18%")).toBeDefined();
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("omits the confidence figure for a candidate that has none", () => {
    const candidates: NBestCandidate[] = [
      { text: "hello word" }, // no confidence
    ];
    const { container } = render(
      <LowConfidencePopup
        id="popup-1"
        confidence={0.56}
        alternativeCandidates={candidates}
      />
    );
    expect(screen.getByText(/hello word/)).toBeDefined();
    // No stray percentage rendered for the candidate row.
    expect(container.textContent).not.toMatch(/hello word.*%/);
  });

  it("is not focusable and holds no interactive controls (no focus trap)", () => {
    const { container } = render(
      <LowConfidencePopup
        id="popup-1"
        confidence={0.5}
        alternativeCandidates={[{ text: "hello worm", confidence: 0.5 }]}
      />
    );
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("[tabindex]")).toBeNull();
    // pointer-events-none guarantees hovering the popup never intercepts the
    // click that opens the editor.
    expect(screen.getByRole("tooltip").className).toContain(
      "pointer-events-none"
    );
  });
});
