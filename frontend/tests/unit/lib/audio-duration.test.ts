import { afterEach, describe, expect, it, vi } from "vitest";
import { readAudioDurationSeconds } from "@/lib/audio-duration";

afterEach(() => {
  vi.restoreAllMocks();
});

function audioBlob() {
  return new Blob(["bytes"], { type: "audio/wav" });
}

describe("readAudioDurationSeconds", () => {
  it("degrades to undefined (never rejects) when createObjectURL throws", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("blocked");
    });

    await expect(
      readAudioDurationSeconds(audioBlob())
    ).resolves.toBeUndefined();
  });

  it("degrades to undefined when the element can't decode the file", async () => {
    // jsdom's <audio> never fires loadedmetadata for a fake blob, so this
    // exercises the error/timeout path resolving to undefined. Use fake timers
    // so the internal metadata timeout resolves without a real wait.
    vi.useFakeTimers();
    const promise = readAudioDurationSeconds(audioBlob());
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
