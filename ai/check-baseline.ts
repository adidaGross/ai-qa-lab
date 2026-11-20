// CI check: does the main suite fail in EXACTLY the expected way?
//
// This project fails tests on purpose (planted bugs + broken tests), so "all tests
// must pass" would always be red. Instead we compare the run with the answer key:
//   - every planted bug must still be caught (its test fails)
//   - every deliberately broken test must still fail
//   - NO other test may fail  (that would be a new, unexpected regression)
//   - NO expected failure may suddenly pass (someone "fixed" a planted bug or broken test)
// Run it with:  npm run test:baseline   (after "npm test")

import fs from "node:fs";
import { readFailedTests } from "./read-results.js";

const bugs = JSON.parse(fs.readFileSync("answer-key/bugs-manifest.json", "utf8")).bugs;
const broken = JSON.parse(fs.readFileSync("answer-key/broken-tests-manifest.json", "utf8")).brokenTests;

const expected = new Set<string>([...bugs.map((b: any) => b.test), ...broken.map((t: any) => t.test)]);
const failed = readFailedTests();
const actual = new Set(failed.map((f) => f.title));

// The healer must be able to cut each failing test out of its file (findTestBlocks in the
// Faultwise package). Checked here so CI catches it without running the AI. Without access to the
// private Faultwise package this one check is skipped; the rest of the baseline still runs.
const unhealable: string[] = [];
const aiQa = await import("faultwise").catch(() => null);
if (!aiQa) console.log("(Skipping the healer check: the private Faultwise package is not installed.)");
const findTestBlocks = aiQa?.findTestBlocks ?? (() => [{ title: "" }]);
for (const f of aiQa ? failed : []) {
  try {
    if (!findTestBlocks(fs.readFileSync(f.file, "utf8")).some((b) => b.title === f.title)) unhealable.push(f.title);
  } catch (err) {
    unhealable.push(`${f.title} (${(err as Error).message})`);
  }
}

const unexpectedFailures = [...actual].filter((title) => !expected.has(title));
const unexpectedPasses = [...expected].filter((title) => !actual.has(title));

console.log(`Expected failures: ${expected.size}   Actual failures: ${actual.size}`);

if (unexpectedFailures.length === 0 && unexpectedPasses.length === 0 && unhealable.length === 0) {
  console.log(`✅ Baseline OK: every planted bug and broken test is caught, nothing else fails${aiQa ? ", and the healer can find every failing test" : ""}.`);
  process.exit(0);
}

for (const title of unexpectedFailures) console.log(`❌ NEW failure (not in the answer key): ${title}`);
for (const title of unexpectedPasses) console.log(`❌ Expected to fail but PASSED: ${title}`);
for (const title of unhealable) console.log(`❌ The healer cannot find this test block: ${title}`);
process.exit(1);
