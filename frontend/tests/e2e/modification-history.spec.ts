import { expect, test } from "@playwright/test";

// Exercises the job-level modification-history table (DIAAT-230) against a
// running backend. Like segment-accept.spec.ts, it depends on a real job
// existing, so it's opt-in: set E2E_HISTORY_JOB_ID to the id of a COMPLETED
// job that already has at least one recorded modification action (a
// correction, rollback, or accept-all) on one of its segments. The backend
// must be reachable by the frontend (BACKEND_INTERNAL_URL) and the job must
// belong to the caller the frontend authenticates as.
const JOB_ID = process.env.E2E_HISTORY_JOB_ID;

test.describe("Modification history table", () => {
  test.skip(
    !JOB_ID,
    "Set E2E_HISTORY_JOB_ID to a seeded job id (with modifications) to run this test"
  );

  test("lists every modification action across the transcript in one table", async ({
    page,
  }) => {
    await page.goto(`/batch/jobs/${JOB_ID}`);

    // The transcript must have rendered.
    await expect(
      page.getByRole("heading", { name: "Transcript", exact: true })
    ).toBeVisible();

    // The modification-history section is collapsed by default; its toggle
    // shows a non-zero count for a job that has modifications.
    const toggle = page.getByRole("button", { name: /modification history/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toContainText("(0)");

    // Expand it and confirm the aggregated table appears with a header row.
    await toggle.click();
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: /action/i })
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: /changed by/i })
    ).toBeVisible();

    // At least one action row is present (header + >= 1 body row).
    const rowCount = await table.getByRole("row").count();
    expect(rowCount).toBeGreaterThan(1);

    // Collapsing hides the table again.
    await toggle.click();
    await expect(page.getByRole("table")).toHaveCount(0);
  });
});
