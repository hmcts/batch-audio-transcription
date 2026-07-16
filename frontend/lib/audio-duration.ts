// Reads the duration of an audio File in the browser, before upload, by
// loading just its metadata into a detached <audio> element. Runs client-side
// because the backend only learns the real duration once Azure has finished
// transcribing — too late to show "Transcribing 2h 36m of audio" while the
// job is still processing. Best-effort: resolves to undefined (rather than
// rejecting) if the browser can't decode the file or metadata never loads, so
// a failure here never blocks the upload itself.

const METADATA_TIMEOUT_MS = 10_000;

export function readAudioDurationSeconds(
  file: Blob
): Promise<number | undefined> {
  return new Promise((resolve) => {
    // No <audio> support (e.g. SSR) — nothing to read.
    if (typeof document === "undefined") {
      resolve(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";

    let settled = false;
    const finish = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };

    const onLoaded = () => {
      const { duration } = audio;
      // Some containers report Infinity/NaN until fully buffered — treat
      // those as "unknown" rather than sending a bogus number.
      finish(Number.isFinite(duration) && duration > 0 ? duration : undefined);
    };
    const onError = () => finish(undefined);

    const timer = setTimeout(() => finish(undefined), METADATA_TIMEOUT_MS);

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
    audio.src = objectUrl;
  });
}
