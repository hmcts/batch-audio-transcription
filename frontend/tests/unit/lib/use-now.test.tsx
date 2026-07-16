import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "@/lib/use-now";

function Clock() {
  const now = useNow();
  return <span>{now.toISOString()}</span>;
}

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T09:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore any vi.spyOn patches (setInterval/clearInterval) — the shared
    // test setup only clears mocks, which wouldn't un-wrap the globals and
    // would leak the spies into later tests.
    vi.restoreAllMocks();
  });

  it("shares a single interval across many subscribers", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    // Render several components that all read the shared clock.
    render(
      <>
        <Clock />
        <Clock />
        <Clock />
      </>
    );

    // Exactly one interval backs all three subscribers, not one each.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("stops the interval once the last subscriber unmounts", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const { unmount } = render(
      <>
        <Clock />
        <Clock />
      </>
    );
    // Still one subscriber's worth of teardown shouldn't clear the interval…
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    unmount();
    // …but unmounting the last subscribers should.
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it("advances the reported time on each tick", () => {
    const { container } = render(<Clock />);
    expect(container.textContent).toContain("2026-07-15T09:00:00");

    // Fake timers advance the system clock too, so 5 ticks lands on +5s.
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(container.textContent).toContain("2026-07-15T09:00:05");
  });
});
