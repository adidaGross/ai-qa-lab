// Reads Playwright's JSON report and returns a simple list of the tests that failed.

import fs from "node:fs";

export type FailedTest = {
  file: string; // e.g. "tests/ui/cart.spec.ts"
  title: string; // the test name, e.g. "remove deletes the clicked item"
  line: number; // where the test starts in the file
  error: string; // the error message Playwright printed
};

// Playwright adds color codes to its messages (for the terminal). We remove them
// so the AI gets clean text.
function stripColors(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

// The report is a tree: suites can contain suites, and suites contain "specs" (tests).
// This function walks the whole tree and collects every failed test.
function collect(suite: any, failures: FailedTest[]) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      const result = test.results.at(-1); // the last attempt
      if (result && result.status !== "passed" && result.status !== "skipped") {
        failures.push({
          file: `tests/${spec.file}`,
          title: spec.title,
          line: spec.line,
          error: stripColors(result.error?.message ?? "Unknown error").slice(0, 4000),
        });
      }
    }
  }
  for (const child of suite.suites ?? []) collect(child, failures);
}

export function readFailedTests(reportPath = "reports/results.json"): FailedTest[] {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`No test report at ${reportPath}. Run "npm test" first.`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const failures: FailedTest[] = [];
  for (const suite of report.suites) collect(suite, failures);
  return failures;
}
