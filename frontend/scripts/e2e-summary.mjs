// Dependency-free parser that turns a Playwright JSON report into a concise
// Markdown summary for the GitHub Actions job summary page ($GITHUB_STEP_SUMMARY).
//
// Why this exists (DIAAT-241): the post-deploy dev e2e job uploads the HTML
// report as an artifact but writes nothing to the job page. Many feature specs
// are env-gated (E2E_*_JOB_ID) and skip against dev, so reviewers can't tell
// ran-vs-skipped without downloading the artifact. This surfaces counts plus
// the ran/skipped breakdown right on the job page.
//
// Usage: node scripts/e2e-summary.mjs [path/to/results.json]
//   Prints Markdown to stdout. Never exits non-zero — it's informational and
//   the workflow step runs with `if: always()`, so a broken summary must not
//   turn a green e2e run red (or mask a red one).

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_REPORT_PATH = "playwright-report/results.json";

/**
 * A flattened view of a single Playwright test, with a readable title and a
 * normalised outcome.
 * @typedef {Object} FlatTest
 * @property {string} title - "spec-file.spec.ts › describe › test title"
 * @property {"passed"|"failed"|"skipped"|"flaky"} outcome
 */

/**
 * Map a Playwright test-level status to a coarse outcome.
 * Playwright test.status is one of: "expected" | "unexpected" | "flaky" | "skipped".
 * @param {string | undefined} status
 * @returns {"passed"|"failed"|"skipped"|"flaky"}
 */
function outcomeFromStatus(status) {
  switch (status) {
    case "skipped":
      return "skipped";
    case "flaky":
      return "flaky";
    case "expected":
      return "passed";
    case "unexpected":
      return "failed";
    default:
      // Unknown/missing status: fall back to results, else treat as failed so
      // it's never silently hidden.
      return "failed";
  }
}

/**
 * Walk the Playwright suite tree and collect every test as a flat list.
 * The report is a tree: suites[].(suites[] | specs[]).tests[]. Root-level
 * suites carry the file path as their title; nested suites carry describe()
 * titles.
 * @param {any} report - parsed Playwright JSON report
 * @returns {FlatTest[]}
 */
export function flattenTests(report) {
  /** @type {FlatTest[]} */
  const out = [];

  /**
   * @param {any} suite
   * @param {string[]} describePath - accumulated describe() titles (no file)
   */
  const walkSuite = (suite, describePath) => {
    if (!suite || typeof suite !== "object") return;

    // A root/file suite carries the file as its title (Playwright uses the
    // testDir-relative path, which is usually the basename); don't add that to
    // the describe path. Match either the full path or the basename so both
    // real reports and full-path fixtures are handled.
    const isFileSuite =
      suite.title &&
      suite.file &&
      (suite.title === suite.file || suite.title === basename(suite.file));
    const nextPath =
      isFileSuite || !suite.title
        ? describePath
        : [...describePath, suite.title];

    for (const spec of suite.specs ?? []) {
      const fileLabel = spec.file ? basename(spec.file) : "unknown";
      const titleParts = [fileLabel, ...nextPath, spec.title].filter(Boolean);
      const title = titleParts.join(" › ");

      for (const test of spec.tests ?? []) {
        out.push({ title, outcome: outcomeFromStatus(test.status) });
      }
    }

    for (const child of suite.suites ?? []) {
      walkSuite(child, nextPath);
    }
  };

  for (const suite of report?.suites ?? []) {
    walkSuite(suite, []);
  }

  return out;
}

/**
 * Reduce flat tests into counts.
 * @param {FlatTest[]} tests
 */
export function countOutcomes(tests) {
  const counts = { total: tests.length, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const t of tests) {
    counts[t.outcome] += 1;
  }
  return counts;
}

/**
 * Escape the handful of characters that would break a Markdown table cell or
 * list line. Test titles are author-controlled, but a stray pipe still
 * mangles a table.
 * @param {string} s
 */
function md(s) {
  return String(s).replace(/\|/g, "\\|");
}

/**
 * Build the full Markdown summary from a parsed Playwright report.
 * @param {any} report
 * @returns {string}
 */
export function renderMarkdown(report) {
  const tests = flattenTests(report);

  if (tests.length === 0) {
    return [
      "## Playwright e2e summary",
      "",
      "> No test results were found in the Playwright report.",
      "",
    ].join("\n");
  }

  const counts = countOutcomes(tests);
  const skipped = tests.filter((t) => t.outcome === "skipped");
  const ran = tests.filter((t) => t.outcome !== "skipped");

  const lines = [];
  lines.push("## Playwright e2e summary");
  lines.push("");

  // Counts table. Flaky column only when there's at least one flaky test.
  const hasFlaky = counts.flaky > 0;
  const header = ["Total", "✅ Passed", "❌ Failed", "⏭️ Skipped"];
  const values = [counts.total, counts.passed, counts.failed, counts.skipped];
  if (hasFlaky) {
    header.push("🟡 Flaky");
    values.push(counts.flaky);
  }
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---:").join(" | ")} |`);
  lines.push(`| ${values.join(" | ")} |`);
  lines.push("");

  // Skipped tests — the whole point of the ticket: show what was gated out.
  lines.push(`### ⏭️ Skipped (${skipped.length})`);
  lines.push("");
  if (skipped.length === 0) {
    lines.push("_None._");
  } else {
    for (const t of skipped) {
      lines.push(`- \`${md(t.title)}\``);
    }
  }
  lines.push("");

  // Ran tests with pass/fail (and flaky) status.
  lines.push(`### Ran (${ran.length})`);
  lines.push("");
  if (ran.length === 0) {
    lines.push("_None._");
  } else {
    const icon = { passed: "✅", failed: "❌", flaky: "🟡" };
    for (const t of ran) {
      lines.push(`- ${icon[t.outcome] ?? "❔"} \`${md(t.title)}\``);
    }
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Read and parse the report file, returning Markdown. Missing/unparseable
 * files produce a clear note rather than throwing.
 * @param {string} reportPath
 * @returns {string}
 */
export function summariseReportFile(reportPath) {
  let raw;
  try {
    raw = readFileSync(reportPath, "utf8");
  } catch {
    return [
      "## Playwright e2e summary",
      "",
      `> No Playwright report found at \`${reportPath}\` — the e2e run may have crashed before writing results.`,
      "",
    ].join("\n");
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch (err) {
    return [
      "## Playwright e2e summary",
      "",
      `> Could not parse the Playwright report at \`${reportPath}\`: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "",
    ].join("\n");
  }

  return renderMarkdown(report);
}

// CLI entry point. Guarded so importing this module (tests) has no side
// effects. pathToFileURL correctly URL-encodes the (Node-resolved, absolute)
// argv[1] path, so the comparison holds even if the runner's path contains
// spaces or other characters that a naive `file://` + path concat would leave
// unmatched — which would silently produce an empty job summary.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const reportPath = process.argv[2] ?? DEFAULT_REPORT_PATH;
  // Never throw: the summary is informational and runs with `if: always()`.
  try {
    process.stdout.write(`${summariseReportFile(reportPath)}\n`);
  } catch (err) {
    process.stdout.write(
      `## Playwright e2e summary\n\n> Failed to build summary: ${
        err instanceof Error ? err.message : String(err)
      }\n`
    );
  }
}
