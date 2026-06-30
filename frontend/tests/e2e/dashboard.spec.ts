import { expect, test } from "@playwright/test";

// These E2E tests require a running server.
// Run with: pnpm run test:e2e (not included in pnpm run test:unit)
// Set PLAYWRIGHT_BASE_URL env var to target a deployed environment.

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/batch");
  });

  test("page title is correct", async ({ page }) => {
    await expect(page).toHaveTitle(/Batch Audio Transcription/);
  });

  test("shows upload section", async ({ page }) => {
    await expect(
      page.getByText(/drag and drop an audio file/i)
    ).toBeVisible();
  });

  test("upload button is initially disabled", async ({ page }) => {
    const btn = page.getByRole("button", {
      name: /upload for transcription/i,
    });
    await expect(btn).toBeDisabled();
  });

  test("shows pre-loaded mock jobs in recent transcripts", async ({
    page,
  }) => {
    await expect(page.getByText("PA/05217/2025")).toBeVisible();
    await expect(page.getByText("EA/11042/2025")).toBeVisible();
  });

  test("View transcript link navigates to transcript page", async ({
    page,
  }) => {
    const link = page.getByRole("link", { name: /view transcript/i }).first();
    await link.click();
    await expect(page).toHaveURL(/\/batch\/jobs\//);
  });

  test("upload a file and see it appear in the list", async ({ page }) => {
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("Audio file input").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "test-hearing.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from("mock-audio"),
    });
    await expect(page.getByText("Selected: test-hearing.mp3")).toBeVisible();

    const submitBtn = page.getByRole("button", {
      name: /upload for transcription/i,
    });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Job appears in the list
    await expect(
      page.getByText("test-hearing.mp3")
    ).toBeVisible({ timeout: 3000 });
  });
});
