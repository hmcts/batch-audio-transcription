import { describe, expect, it } from "vitest";
// The summary parser is a dependency-free .mjs so it can run from the workflow
// with plain `node`; vitest imports the same module here.
import {
  countOutcomes,
  flattenTests,
  renderMarkdown,
  summariseReportFile,
} from "../../scripts/e2e-summary.mjs";

// A representative Playwright JSON report: nested describe suites, and a mix of
// passed (expected), failed (unexpected), skipped and flaky tests across two
// spec files.
const sampleReport = {
  config: {},
  stats: { expected: 2, unexpected: 1, skipped: 2, flaky: 1 },
  suites: [
    {
      title: "dashboard.spec.ts",
      file: "dashboard.spec.ts",
      specs: [],
      suites: [
        {
          title: "Dashboard",
          file: "dashboard.spec.ts",
          specs: [
            {
              title: "page title is correct",
              file: "dashboard.spec.ts",
              ok: true,
              tests: [{ status: "expected" }],
            },
            {
              title: "shows an empty state when there are no jobs yet",
              file: "dashboard.spec.ts",
              ok: true,
              tests: [{ status: "skipped" }],
            },
          ],
          suites: [],
        },
      ],
    },
    {
      title: "baseline-wer.spec.ts",
      file: "baseline-wer.spec.ts",
      specs: [
        {
          title: "upload a baseline transcript and see the baseline WER appear",
          file: "baseline-wer.spec.ts",
          ok: true,
          tests: [{ status: "skipped" }],
        },
      ],
      suites: [
        {
          title: "Progress",
          file: "baseline-wer.spec.ts",
          specs: [
            {
              title: "shows progress bar",
              file: "baseline-wer.spec.ts",
              ok: false,
              tests: [{ status: "unexpected" }],
            },
            {
              title: "eventually reaches completed",
              file: "baseline-wer.spec.ts",
              ok: true,
              tests: [{ status: "flaky" }],
            },
          ],
          suites: [],
        },
      ],
    },
  ],
};

describe("flattenTests", () => {
  it("recurses nested suites and builds readable titles", () => {
    const flat = flattenTests(sampleReport);
    expect(flat).toHaveLength(5);

    const titles = flat.map((t) => t.title);
    // File-level suite title is not duplicated into the path; describe titles are.
    expect(titles).toContain(
      "dashboard.spec.ts › Dashboard › page title is correct"
    );
    // Specs directly on a file suite (no describe) omit the describe segment.
    expect(titles).toContain(
      "baseline-wer.spec.ts › upload a baseline transcript and see the baseline WER appear"
    );
    expect(titles).toContain(
      "baseline-wer.spec.ts › Progress › shows progress bar"
    );
  });

  it("maps Playwright statuses to coarse outcomes", () => {
    const flat = flattenTests(sampleReport);
    const byTitle = Object.fromEntries(flat.map((t) => [t.title, t.outcome]));
    expect(
      byTitle["dashboard.spec.ts › Dashboard › page title is correct"]
    ).toBe("passed");
    expect(
      byTitle[
        "dashboard.spec.ts › Dashboard › shows an empty state when there are no jobs yet"
      ]
    ).toBe("skipped");
    expect(
      byTitle["baseline-wer.spec.ts › Progress › shows progress bar"]
    ).toBe("failed");
    expect(
      byTitle["baseline-wer.spec.ts › Progress › eventually reaches completed"]
    ).toBe("flaky");
  });
});

describe("countOutcomes", () => {
  it("counts totals per outcome", () => {
    const counts = countOutcomes(flattenTests(sampleReport));
    expect(counts).toEqual({
      total: 5,
      passed: 1,
      failed: 1,
      skipped: 2,
      flaky: 1,
    });
  });
});

describe("renderMarkdown", () => {
  const md = renderMarkdown(sampleReport);

  it("includes a counts table with a flaky column when flaky tests exist", () => {
    expect(md).toContain(
      "| Total | ✅ Passed | ❌ Failed | ⏭️ Skipped | 🟡 Flaky |"
    );
    expect(md).toContain("| 5 | 1 | 1 | 2 | 1 |");
  });

  it("lists skipped test titles under a Skipped heading", () => {
    expect(md).toContain("### ⏭️ Skipped (2)");
    expect(md).toContain(
      "- `baseline-wer.spec.ts › upload a baseline transcript and see the baseline WER appear`"
    );
  });

  it("lists ran tests with pass/fail/flaky icons", () => {
    expect(md).toContain("### Ran (3)");
    expect(md).toContain(
      "- ✅ `dashboard.spec.ts › Dashboard › page title is correct`"
    );
    expect(md).toContain(
      "- ❌ `baseline-wer.spec.ts › Progress › shows progress bar`"
    );
    expect(md).toContain(
      "- 🟡 `baseline-wer.spec.ts › Progress › eventually reaches completed`"
    );
  });

  it("omits the flaky column when there are no flaky tests", () => {
    const noFlaky = {
      suites: [
        {
          title: "a.spec.ts",
          file: "a.spec.ts",
          specs: [
            { title: "t1", file: "a.spec.ts", tests: [{ status: "expected" }] },
          ],
          suites: [],
        },
      ],
    };
    const out = renderMarkdown(noFlaky);
    expect(out).toContain("| Total | ✅ Passed | ❌ Failed | ⏭️ Skipped |");
    expect(out).not.toContain("Flaky");
  });
});

describe("edge cases", () => {
  it("renders a 'no results' note for an empty report", () => {
    expect(renderMarkdown({ suites: [] })).toContain(
      "No test results were found"
    );
  });

  it("renders a 'no report' note when the file is missing", () => {
    const out = summariseReportFile("does/not/exist/results.json");
    expect(out).toContain("No Playwright report found");
    expect(out).toContain("does/not/exist/results.json");
  });
});
