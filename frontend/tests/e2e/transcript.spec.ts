import { expect, test } from "@playwright/test";

// These E2E tests require a running server with a real backend.
// Run with: pnpm run test:e2e (not included in pnpm run test:unit)
// Set PLAYWRIGHT_BASE_URL env var to target a deployed environment.
//
// Tests that navigate to a specific job require E2E_JOB_ID to be set to an
// existing job id in that environment. Without it the suite is skipped rather
// than failing with a 404 or brittle hardcoded fixtures.
const JOB_ID = process.env.E2E_JOB_ID;
const JOB_AVAILABLE = !!JOB_ID;

test.describe("Transcript page — known job", () => {
  test.skip(!JOB_AVAILABLE, "Set E2E_JOB_ID to a real job id to run these tests");

  test.beforeEach(async ({ page }) => {
    await page.goto(`/batch/jobs/${JOB_ID}`);
  });

  test("shows a heading with the job's case reference", async ({ page }) => {
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("shows transcript segments", async ({ page }) => {
    await expect(page.locator("[data-testid='transcript-segment']").first()).toBeVisible();
  });

  test("shows accuracy sidebar", async ({ page }) => {
    await expect(page.getByText("Transcript accuracy")).toBeVisible();
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
});

test.describe("Transcript page — error states", () => {
  test("unknown job id shows 404 page", async ({ page }) => {
    await page.goto("/batch/jobs/does-not-exist");
    await expect(page.getByText(/transcript not found/i)).toBeVisible();
  });
});
