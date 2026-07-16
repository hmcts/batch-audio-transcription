import { expect, test } from "@playwright/test";

// Verifies the richer processing-job progress display (DIAAT-226): elapsed
// time, an estimated remaining time, the "Transcribing 2h 36m of audio"
// message, and that the estimate refreshes as polling updates the job.
//
// The dashboard fetches its job list client-side from the app's own
// /batch/api/jobs route (which normally proxies the real backend). We
// intercept that route in the browser and return a fixed PROCESSING job in
// the frontend's TranscriptionJob shape, so the progress UI can be asserted
// deterministically without a live backend or a real Azure batch job.
// Run with: pnpm run test:e2e (app must already be running).

const PROCESSING_JOB = {
  id: "job-e2e-processing",
  caseReference: "PA/09999/2026",
  tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
  audioFileName: "long_hearing.mp3",
  // Submitted 10 minutes before "now" so elapsed time is clearly non-zero.
  uploadedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  status: "PROCESSING",
  progressPercent: 60,
  audioDurationSeconds: 9360, // 2h 36m
};

test.describe("Processing job progress display", () => {
  test("shows elapsed time, estimated remaining, and audio duration", async ({
    page,
  }) => {
    let payload = { ...PROCESSING_JOB };
    await page.route("**/api/jobs", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobs: [payload] }),
      });
    });

    await page.goto("/batch");

    const row = page.locator("tr", { hasText: "long_hearing.mp3" }).first();
    await expect(row).toBeVisible();

    // Acceptance criteria 1, 2 and 3.
    await expect(row.getByText("Transcribing 2h 36m of audio.")).toBeVisible();
    await expect(row.getByText(/Elapsed: 10m/)).toBeVisible();
    await expect(row.getByText(/Estimated remaining:/)).toBeVisible();
    // The existing percentage readout still renders.
    await expect(row.getByText("60%")).toBeVisible();

    // Acceptance criterion 4: the estimate updates as polling refreshes the
    // job. Advance the reported progress; the dashboard re-polls every 5s.
    const estimateBefore = await row
      .getByText(/Estimated remaining:/)
      .textContent();
    payload = { ...PROCESSING_JOB, progressPercent: 90 };

    await expect
      .poll(async () => row.getByText(/Estimated remaining:/).textContent(), {
        timeout: 15_000,
      })
      .not.toBe(estimateBefore);
  });
});
