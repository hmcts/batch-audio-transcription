import path from "node:path";
import { expect, test } from "@playwright/test";

// These E2E tests require a running server with a real backend behind it
// (docker-compose, or `pnpm dev` + the transcription_svc API) — there is no
// more mock data to fall back on.
// Run with: pnpm run test:e2e (not included in pnpm run test:unit)
// Set PLAYWRIGHT_BASE_URL env var to target a deployed environment.

const REAL_AUDIO_PATH =
  process.env.E2E_AUDIO_FILE ??
  path.join("/Users/hmcts/Downloads", "24-813.mp3");

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/batch");
  });

  test("page title is correct", async ({ page }) => {
    await expect(page).toHaveTitle(/Batch Audio Transcription/);
  });

  test("shows upload section", async ({ page }) => {
    await expect(page.getByText(/drag and drop an audio file/i)).toBeVisible();
  });

  test("upload button is initially disabled", async ({ page }) => {
    const btn = page.getByRole("button", {
      name: /upload for transcription/i,
    });
    await expect(btn).toBeDisabled();
  });

  test("shows an empty state when there are no jobs yet", async ({ page }) => {
    const jobsSections = page.locator("section", { hasText: "All uploads" });
    await expect(
      jobsSections.getByText(/no transcription jobs yet/i)
    ).toBeVisible();
  });
});

// Full round trip against the real backend and real Azure Speech Batch —
// slow (batch transcription can take minutes), so it's isolated here rather
// than mixed into the fast dashboard checks above.
test.describe("Real transcription pipeline", () => {
  test("upload real audio and see the transcript appear", async ({ page }) => {
    test.setTimeout(15 * 60 * 1000); // batch transcription can take a while

    await page.goto("/batch");

    await page.getByLabel("Audio file input").setInputFiles(REAL_AUDIO_PATH);
    const fileName = path.basename(REAL_AUDIO_PATH);
    await expect(page.getByText(`Selected: ${fileName}`)).toBeVisible();

    const submitBtn = page.getByRole("button", {
      name: /upload for transcription/i,
    });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Job appears in the "All uploads" list, initially PENDING/PROCESSING.
    const allUploads = page.locator("section", { hasText: "All uploads" });
    await expect(allUploads.getByText(fileName)).toBeVisible({
      timeout: 10_000,
    });

    // Poll (via page reloads) until the job reaches COMPLETED and a
    // "View transcript" link shows up, or FAILED is surfaced explicitly.
    const row = allUploads.locator("tr", { hasText: fileName });
    await expect(async () => {
      await page.reload();
      const text = await row.innerText();
      expect(text).not.toMatch(/failed/i);
      expect(text).toMatch(/view transcript/i);
    }).toPass({ timeout: 15 * 60 * 1000, intervals: [5000] });

    await row.getByRole("link", { name: /view transcript/i }).click();
    await expect(page).toHaveURL(/\/batch\/jobs\//);
    await expect(page.locator("main")).toContainText(/./); // transcript rendered
  });
});
