import { expect, type Page, test } from "@playwright/test";

// E2E coverage for the -10s / +10s audio skip controls (DIAAT-238).
//
// There's no fixed job id and no mock data, so this test discovers a
// COMPLETED job from the dashboard and drives its transcript player. When
// the environment has no completed job available (e.g. the backend-less
// `pnpm run start` used by the E2E Tests workflow), it skips rather than
// failing — matching the opt-in pattern the other specs use.
//
// Run with: pnpm run test:e2e (app must already be running; see
// playwright.config.ts — there is no webServer).

const SEEK_STEP = 10;
// Playback keeps advancing between a click and the position read, so exact
// equality would be flaky — allow a small drift while still proving the
// seek landed where expected.
const TOLERANCE = 1.5;

function audioCurrentTime(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector("audio");
    return el ? el.currentTime : Number.NaN;
  });
}

function audioDuration(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector("audio");
    return el ? el.duration : Number.NaN;
  });
}

function audioPaused(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector("audio");
    return el ? el.paused : true;
  });
}

test.describe("Audio skip controls (-10s / +10s)", () => {
  test("skips back and forward by 10s, clamps at bounds, and keeps playing", async ({
    page,
  }) => {
    await page.goto("/batch");

    // The dashboard fetches jobs client-side, so wait for the list to
    // settle before deciding whether a completed job exists. Skip cleanly
    // if none is available in this environment (nothing to seek through) —
    // e.g. the backend-less `pnpm run start` used by the E2E workflow.
    const viewLink = page
      .getByRole("link", { name: /view transcript/i })
      .first();
    const hasCompletedJob = await viewLink
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(
      !hasCompletedJob,
      "No completed transcription job available to exercise the audio player"
    );

    await viewLink.click();
    await expect(page).toHaveURL(/\/batch\/jobs\//);

    const back = page.getByRole("button", { name: /skip back 10 seconds/i });
    const forward = page.getByRole("button", {
      name: /skip forward 10 seconds/i,
    });
    await expect(back).toBeVisible();
    await expect(forward).toBeVisible();

    // Wait for the <audio> element's metadata so duration/currentTime are
    // meaningful before we start seeking.
    await expect
      .poll(async () => await audioDuration(page), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const duration = await audioDuration(page);

    // --- Deterministic seeks while paused: currentTime is set exactly, no
    // playback drift, so we can assert precise clamped positions. ---
    expect(await audioCurrentTime(page)).toBeCloseTo(0, 0);

    // +10s from the start -> min(duration, 10).
    await forward.click();
    const expectedForward = Math.min(duration, SEEK_STEP);
    await expect
      .poll(async () => await audioCurrentTime(page))
      .toBeGreaterThan(expectedForward - TOLERANCE);
    expect(await audioCurrentTime(page)).toBeLessThan(
      expectedForward + TOLERANCE
    );

    // -10s back down -> clamps at 0, never negative.
    await back.click();
    await back.click();
    await expect
      .poll(async () => await audioCurrentTime(page))
      .toBeLessThan(TOLERANCE);
    expect(await audioCurrentTime(page)).toBeGreaterThanOrEqual(0);

    // --- Seek while playing: playback must continue from the new position. ---
    const playPause = page.getByRole("button", { name: /^play$/i });
    await playPause.click();
    // Confirm real playback is advancing.
    await expect
      .poll(async () => await audioCurrentTime(page), { timeout: 5_000 })
      .toBeGreaterThan(0.5);

    // A +10s jump while playing should move forward and keep playing.
    const before = await audioCurrentTime(page);
    await forward.click();
    await expect
      .poll(async () => await audioCurrentTime(page))
      .toBeGreaterThan(before + SEEK_STEP - TOLERANCE);
    expect(await audioPaused(page)).toBe(false);
  });
});
