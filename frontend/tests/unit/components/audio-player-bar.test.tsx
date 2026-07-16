import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AudioPlayerBar } from "@/components/transcript/audio-player-bar";

function setup(overrides: Partial<Parameters<typeof AudioPlayerBar>[0]> = {}) {
  const onTogglePlay = vi.fn();
  const onSeek = vi.fn();
  const onSpeedChange = vi.fn();
  render(
    <AudioPlayerBar
      duration={200}
      position={50}
      playing={false}
      onTogglePlay={onTogglePlay}
      onSeek={onSeek}
      onSpeedChange={onSpeedChange}
      {...overrides}
    />
  );
  return { onTogglePlay, onSeek, onSpeedChange };
}

describe("AudioPlayerBar", () => {
  it("shows the play icon and label when not playing", () => {
    setup({ playing: false });
    expect(screen.getByRole("button", { name: /^play$/i })).toBeDefined();
  });

  it("shows the pause icon and label when playing", () => {
    setup({ playing: true });
    expect(screen.getByRole("button", { name: /^pause$/i })).toBeDefined();
  });

  it("calls onTogglePlay when the play/pause button is clicked", async () => {
    const user = userEvent.setup();
    const { onTogglePlay } = setup();
    await user.click(screen.getByRole("button", { name: /^play$/i }));
    expect(onTogglePlay).toHaveBeenCalledOnce();
  });

  it("renders explicit, visible −10s and +10s skip labels", () => {
    setup();
    const back = screen.getByRole("button", { name: /skip back 10 seconds/i });
    const forward = screen.getByRole("button", {
      name: /skip forward 10 seconds/i,
    });
    // Direction must be explicit in the visible text (not sr-only, not just
    // an icon) — assert the full labels so a regression back to ambiguous
    // "10s" text fails the test.
    expect(back.textContent).toContain("−10s");
    expect(forward.textContent).toContain("+10s");
  });

  it("seeks 10s back, clamped at 0", async () => {
    const user = userEvent.setup();
    const { onSeek } = setup({ position: 5 });
    await user.click(screen.getByRole("button", { name: /skip back/i }));
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("seeks 10s forward, clamped at duration", async () => {
    const user = userEvent.setup();
    const { onSeek } = setup({ position: 195, duration: 200 });
    await user.click(screen.getByRole("button", { name: /skip forward/i }));
    expect(onSeek).toHaveBeenCalledWith(200);
  });

  it("stays at 0 when skipping back while already at the start", async () => {
    const user = userEvent.setup();
    const { onSeek } = setup({ position: 0, duration: 200 });
    await user.click(screen.getByRole("button", { name: /skip back/i }));
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("stays at duration when skipping forward while already at the end", async () => {
    const user = userEvent.setup();
    const { onSeek } = setup({ position: 200, duration: 200 });
    await user.click(screen.getByRole("button", { name: /skip forward/i }));
    expect(onSeek).toHaveBeenCalledWith(200);
  });

  it("seeks a plain 10s back/forward when away from either bound", async () => {
    const user = userEvent.setup();
    const { onSeek } = setup({ position: 100, duration: 200 });
    await user.click(screen.getByRole("button", { name: /skip back/i }));
    expect(onSeek).toHaveBeenCalledWith(90);
    await user.click(screen.getByRole("button", { name: /skip forward/i }));
    expect(onSeek).toHaveBeenCalledWith(110);
  });

  it("seeks to the clicked position along the timeline", async () => {
    const { onSeek } = setup({ duration: 200 });
    const timeline = screen.getByLabelText("Audio timeline");
    vi.spyOn(timeline, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      height: 32,
      right: 1000,
      bottom: 32,
      x: 0,
      y: 0,
      toJSON() {
        return this;
      },
    });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(timeline, { clientX: 500 });
    expect(onSeek).toHaveBeenCalledWith(100);
  });

  it("calls onSpeedChange when the speed selector changes", async () => {
    const user = userEvent.setup();
    const { onSpeedChange } = setup();
    await user.selectOptions(screen.getByLabelText("Playback speed"), "1.5");
    expect(onSpeedChange).toHaveBeenCalledWith(1.5);
  });
});
