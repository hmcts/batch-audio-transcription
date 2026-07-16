import { expect, test } from "@playwright/test";

// Uploading a baseline transcript and seeing a real WER appear needs a
// COMPLETED job to exist in the backend, which is environment-specific
// (there's no fixed mock job any more). Opt in by setting
// E2E_BASELINE_JOB_ID to a seeded, SUCCEEDED job's id — the test skips
// otherwise, so it never breaks environments without a backend (e.g. the
// container-only e2e workflow).
// Run with: pnpm run test:e2e (not included in pnpm run test:unit)
const BASELINE_JOB_ID = process.env.E2E_BASELINE_JOB_ID;

test.describe("Baseline transcript WER", () => {
  test.skip(
    !BASELINE_JOB_ID,
    "Set E2E_BASELINE_JOB_ID to a seeded COMPLETED job's id to run this test"
  );

  test("upload a baseline transcript and see the baseline WER appear", async ({
    page,
  }) => {
    await page.goto(`/batch/jobs/${BASELINE_JOB_ID}`);

    // The accuracy panel is present and, before any baseline is uploaded,
    // offers the upload action and shows no baseline WER.
    const uploadButton = page.getByRole("button", {
      name: /upload baseline transcript/i,
    });
    await expect(uploadButton).toBeVisible();
    await expect(page.getByText("Baseline WER")).toHaveCount(0);

    // Upload a reference transcript that deliberately differs from the
    // auto-generated text, so the resulting WER is non-zero and visible.
    const baseline =
      "good evening we are off the record now\n" +
      "good morning your honour I appear for the appellant today";
    const uploadResponse = page.waitForResponse(
      (r) => r.url().includes("/baseline") && r.request().method() === "POST"
    );
    await page
      .locator('input[aria-label="Baseline transcript file input"]')
      .setInputFiles({
        name: "reference-transcript.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(baseline, "utf-8"),
      });
    expect((await uploadResponse).status()).toBe(200);

    // The baseline WER is surfaced in the accuracy panel, clearly labelled
    // and distinguished from the correction-based WER, and the action
    // switches to "Replace".
    await expect(page.getByText("Baseline WER")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/%$/).first()).toBeVisible();
    await expect(
      page.getByText(
        /independent of any corrections|unaffected by corrections/i
      )
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /replace baseline transcript/i })
    ).toBeVisible();
  });
});
