import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// These E2E tests require a running server with a real backend behind it
// (docker-compose, or `pnpm dev` + the transcription_svc API) — there is no
// more mock data to fall back on.
// Run with: pnpm run test:e2e (not included in pnpm run test:unit)
// Set PLAYWRIGHT_BASE_URL env var to target a deployed environment.

// Opt-in only: no default path, since a real audio file is developer/CI
// environment-specific and shouldn't be assumed to exist.
const REAL_AUDIO_PATH = process.env.E2E_AUDIO_FILE;
const REAL_AUDIO_AVAILABLE =
  !!REAL_AUDIO_PATH && fs.existsSync(REAL_AUDIO_PATH);

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
    // Gated on E2E_EXPECT_EMPTY (DIAAT-241): only meaningful against an empty
    // backend. Local `pnpm dev` and the backend-less CI e2e run start empty,
    // so it asserts by default. The post-deploy dev run sets
    // E2E_EXPECT_EMPTY=false because dev has real jobs, so this test skips
    // there rather than failing.
    test.skip(
      process.env.E2E_EXPECT_EMPTY === "false",
      "Backend has existing jobs (E2E_EXPECT_EMPTY=false); empty-state check not applicable"
    );

    // The full-history list is the "Uploads (N)" section (see app/page.tsx);
    // an earlier "All uploads" locator matched no markup and always failed.
    const uploadsSection = page
      .locator("section")
      .filter({ hasText: /^Uploads/ });
    await expect(
      uploadsSection.getByText(/no transcription jobs yet/i)
    ).toBeVisible();
  });
});

// Run metadata popover (DIAAT-227). Requires a real backend behind the
// frontend with at least one completed job whose run metadata has been
// populated — skips otherwise (e.g. CI's backend-less e2e run) rather than
// failing, mirroring the "Real transcription pipeline" test below.
test.describe("Transcription run metadata popover", () => {
  test("surfaces audio length, transcription time and model on the file name", async ({
    page,
  }) => {
    await page.goto("/batch");

    // The file name becomes an info trigger only once run metadata exists.
    // Jobs load via a client-side fetch after mount, so wait for the trigger
    // to appear; skip (rather than fail) if this backend has no such job —
    // e.g. CI's backend-less e2e run.
    const trigger = page
      .getByRole("button", { name: /transcription run details for/i })
      .first();

    try {
      await trigger.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      test.skip(
        true,
        "No completed job with run metadata available on this backend"
      );
    }

    // Metadata is not shown until the clerk interacts — no need to open the
    // transcript for it.
    await expect(page.getByText(/audio length/i)).toHaveCount(0);

    await trigger.click();

    // Popover reveals all three pieces of run metadata.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/audio length/i)).toBeVisible();
    await expect(dialog.getByText(/transcription time/i)).toBeVisible();
    await expect(dialog.getByText(/^model$/i)).toBeVisible();

    // Clicking the file name shows metadata rather than navigating to the
    // transcript view.
    await expect(page).toHaveURL(/\/batch\/?$/);
  });
});

// Full round trip against the real backend and real Azure Speech Batch —
// slow (batch transcription can take minutes), so it's isolated here rather
// than mixed into the fast dashboard checks above.
test.describe("Real transcription pipeline", () => {
  test.skip(
    !REAL_AUDIO_AVAILABLE,
    "Set E2E_AUDIO_FILE to a real audio file's path to run this test"
  );

  test("upload real audio and see the transcript appear", async ({ page }) => {
    test.setTimeout(15 * 60 * 1000); // batch transcription can take a while

    const audioPath = REAL_AUDIO_PATH as string;
    await page.goto("/batch");

    await page.getByLabel("Audio file input").setInputFiles(audioPath);
    const fileName = path.basename(audioPath);
    await expect(page.getByText(`Selected: ${fileName}`)).toBeVisible();

    const submitBtn = page.getByRole("button", {
      name: /upload for transcription/i,
    });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Job appears in the "Uploads (N)" list, initially PENDING/PROCESSING.
    // Generous timeout: the upload request is synchronous end-to-end (file
    // bytes -> blob storage -> Speech Batch submission) before the button
    // re-enables, so a real multi-MB file over a real network can take a
    // couple of minutes here, not just a local-only round trip.
    const allUploads = page.locator("section").filter({ hasText: /^Uploads/ });
    await expect(allUploads.getByText(fileName)).toBeVisible({
      timeout: 180_000,
    });

    // Poll (via page reloads) until the job reaches COMPLETED and a
    // "View transcript" link shows up. Exits as soon as FAILED appears
    // instead of retrying blindly for the full timeout — a terminal FAILED
    // status will never turn into a pass, so waiting out toPass()'s full
    // window on it just wastes ~15 minutes per run.
    const row = allUploads.locator("tr", { hasText: fileName });
    const deadline = Date.now() + 15 * 60 * 1000;
    let text = "";
    while (Date.now() < deadline) {
      await page.reload();
      text = await row.innerText();
      if (/failed/i.test(text)) {
        throw new Error(`Job reached FAILED status:\n${text}`);
      }
      if (/view transcript/i.test(text)) break;
      await page.waitForTimeout(5000);
    }
    expect(text).toMatch(/view transcript/i);

    await row.getByRole("link", { name: /view transcript/i }).click();
    await expect(page).toHaveURL(/\/batch\/jobs\//);
    await expect(page.locator("main")).toContainText(/./); // transcript rendered
  });
});
