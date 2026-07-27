import { expect, test } from "@playwright/test";

// Verifies the unified processing-job progress display (DIAAT-244): the bar
// percentage and the estimated remaining time are BOTH derived from one
// time-based model grounded in Azure's ~5x processing rate, so they always
// agree, plus the "Transcribing 2h 36m of audio" message and that the readouts
// advance as the live clock ticks.
//
// The dashboard fetches its job list client-side from the app's own
// /batch/api/jobs route (which normally proxies the real backend). We
// intercept that route in the browser and return a fixed PROCESSING job in
// the frontend's TranscriptionJob shape, so the progress UI can be asserted
// deterministically without a live backend or a real Azure batch job.
// Run with: pnpm run test:e2e (app must already be running).

// Built fresh inside the test (not at module load) with `uploadedAt` relative
// to the moment the test runs, so elapsed time is deterministic regardless of
// how long the runner takes to start the browser.
function makeProcessingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-e2e-processing",
    caseReference: "PA/09999/2026",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "long_hearing.mp3",
    // Submitted 10 minutes before "now" so elapsed time is clearly non-zero.
    uploadedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    status: "PROCESSING",
    audioDurationSeconds: 9360, // 2h 36m -> est = 9360/5 = 1872s (31.2m)
    ...overrides,
  };
}

test.describe("Processing job progress display", () => {
  test("shows elapsed time, estimated remaining, and audio duration", async ({
    page,
  }) => {
    const payload = makeProcessingJob();
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

    // Acceptance criteria 1, 2 and 3. The elapsed readout is asserted with a
    // tolerant matcher: it's ~10m but formatDuration rounds to the nearest
    // minute, so a few seconds of runner latency can tip it to 11m.
    await expect(row.getByText("Transcribing 2h 36m of audio.")).toBeVisible();
    await expect(row.getByText(/Elapsed: 1[01]m/)).toBeVisible();
    await expect(row.getByText(/Estimated remaining:/)).toBeVisible();
    // The bar percentage is now time-derived (DIAAT-244): est = 1872s and
    // elapsed ≈ 600s, so round(600/1872*100) ≈ 32%. A tolerant range absorbs a
    // few seconds of runner latency around the 10-minute mark.
    await expect(row.getByText(/3[0-4]%/)).toBeVisible();

    // The readouts advance as the shared live clock ticks (progress is no
    // longer driven by a status placeholder). The bar percentage is the fastest
    // observable change — around the 10-minute mark each 1% step is ~19s — so
    // within a modest window it ticks up (e.g. 32% -> 33%), confirming the bar
    // is live rather than a frozen placeholder.
    const percentBefore = await row.getByText(/\d+%/).textContent();

    await expect
      .poll(async () => row.getByText(/\d+%/).textContent(), {
        timeout: 30_000,
      })
      .not.toBe(percentBefore);
  });
});
