import { expect, test } from "@playwright/test";

// These E2E tests require a running server.
// Run with: pnpm run test:e2e (not included in pnpm run test:unit)
// Set PLAYWRIGHT_BASE_URL env var to target a deployed environment.

const JOB_ID = "job-pa05217-2025";

test.describe("Transcript page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/batch/jobs/${JOB_ID}`);
  });

  test("shows case reference as heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "PA/05217/2025" })
    ).toBeVisible();
  });

  test("shows tribunal name", async ({ page }) => {
    await expect(
      page.getByText("First-tier Tribunal — Immigration and Asylum Chamber")
    ).toBeVisible();
  });

  test("shows transcript segments", async ({ page }) => {
    await expect(
      page.getByText("Good morning. We are on the record")
    ).toBeVisible();
  });

  test("shows accuracy sidebar", async ({ page }) => {
    await expect(page.getByText("Transcript accuracy")).toBeVisible();
    await expect(page.getByText("4.7%")).toBeVisible();
    await expect(page.getByText("2,284")).toBeVisible();
  });

  test("shows needs review panel", async ({ page }) => {
    await expect(page.getByText("Needs review")).toBeVisible();
  });

  test("back link returns to dashboard", async ({ page }) => {
    await page.getByRole("link", { name: /back to hearing list/i }).click();
    await expect(page).toHaveURL("/batch");
  });

  test("audio player controls are visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /play/i })).toBeVisible();
  });

  test("unknown job id shows 404 page", async ({ page }) => {
    await page.goto("/batch/jobs/does-not-exist");
    await expect(page.getByText(/transcript not found/i)).toBeVisible();
  });
});
