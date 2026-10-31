import { describe, expect, it } from "vitest";
import {
  buildHearingUploadForms,
  HEARING_FILE_COUNT_FIELD,
  HEARING_ID_FIELD,
  parseHearingUpload,
} from "@/lib/hearing-upload";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function audio(name: string) {
  return new File(["bytes"], name, { type: "audio/wav" });
}

describe("buildHearingUploadForms (DIAAT-280)", () => {
  it("gives every file of one batch the same hearing ID and the batch's file count", () => {
    const forms = buildHearingUploadForms([
      { file: audio("part1.wav"), durationSeconds: 12.5 },
      { file: audio("part2.wav") },
    ]);

    expect(forms).toHaveLength(2);
    const [first, second] = forms;
    expect(first.get(HEARING_ID_FIELD)).toMatch(UUID_RE);
    expect(second.get(HEARING_ID_FIELD)).toBe(first.get(HEARING_ID_FIELD));
    expect(first.get(HEARING_FILE_COUNT_FIELD)).toBe("2");
    expect(second.get(HEARING_FILE_COUNT_FIELD)).toBe("2");
    expect((first.get("file") as File).name).toBe("part1.wav");
    expect((second.get("file") as File).name).toBe("part2.wav");
    expect(first.get("audio_duration_seconds")).toBe("12.5");
    expect(second.get("audio_duration_seconds")).toBeNull();
    // What the browser sends is what the route accepts.
    expect(
      parseHearingUpload(
        first.get(HEARING_ID_FIELD),
        first.get(HEARING_FILE_COUNT_FIELD)
      )
    ).toEqual({ hearingId: first.get(HEARING_ID_FIELD), fileCount: 2 });
  });

  it("gives separate batches separate hearing IDs", () => {
    const [a] = buildHearingUploadForms([{ file: audio("a.wav") }]);
    const [b] = buildHearingUploadForms([{ file: audio("b.wav") }]);
    expect(a.get(HEARING_FILE_COUNT_FIELD)).toBe("1");
    expect(b.get(HEARING_ID_FIELD)).not.toBe(a.get(HEARING_ID_FIELD));
  });
});
