// The healer: takes the AI's fixes for broken tests and
//   1. writes them to tests/healed/ (same file name, same test name as the original)
//   2. runs the healed tests to prove the fixes work
//   3. saves the outcome to reports/healing.json for the final report
// The original tests are NEVER changed. A person reviews the healed version first.
// Run it with:  npm run ai:heal   (after "npm run ai:analyze")

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { playwrightCommand } from "./commands.js";
import { findTestBlocks } from "faultwise";
import { readFailedTests } from "./read-results.js";

const analysis = JSON.parse(fs.readFileSync("reports/ai-analysis.json", "utf8"));

// ---------- 1. Pick the test bugs that have a fix ----------
type Healing = {
  file: string; // original file, e.g. tests/ui/login.spec.ts
  healedFile: string; // e.g. tests/healed/ui/login.spec.ts
  title: string;
  problem: string; // what was wrong with the test
  fixExplanation: string; // what the AI changed
  originalError: string;
  originalCode: string;
  fixedCode: string;
  rerunStatus?: "passed" | "failed" | "not-run";
  rerunError?: string;
};

const healings: Healing[] = [];
for (const r of analysis.results) {
  if (r.analysis?.classification !== "test-bug" || !r.analysis.testFix) continue;
  healings.push({
    file: r.test.file,
    healedFile: r.test.file.replace(/^tests\//, "tests/healed/"),
    title: r.test.title,
    problem: r.analysis.rootCause,
    fixExplanation: r.analysis.testFix.explanation,
    originalError: r.test.error,
    originalCode: "",
    fixedCode: r.analysis.testFix.fixedTestCode.trim(),
  });
}

if (healings.length === 0) {
  console.log("No test bugs to heal. 🎉");
  process.exit(0);
}

// ---------- 2. Build one healed file per original file ----------
// We start from the original file (so imports, helpers and beforeEach stay),
// remove all tests, and put back only the fixed ones.
fs.rmSync("tests/healed", { recursive: true, force: true }); // fresh start each run

const byFile = Map.groupBy(healings, (h) => h.file);
for (const [file, fixes] of byFile) {
  const source = fs.readFileSync(file, "utf8");
  const blocks = findTestBlocks(source);

  let healedSource = source;
  // Go from the bottom of the file up, so earlier positions stay correct while we cut.
  for (const block of [...blocks].reverse()) {
    const fix = fixes.find((f) => f.title === block.title);
    if (fix) fix.originalCode = block.code;
    healedSource = healedSource.slice(0, block.start) + (fix ? fix.fixedCode : "") + healedSource.slice(block.end);
  }
  healedSource = healedSource.replace(/\n{3,}/g, "\n\n"); // tidy up empty lines left behind

  // The healed file lives one folder deeper (tests/healed/...), so relative imports such as
  // "../support/account.js" must point one level further up to reach the same helper file.
  const healedDir = path.dirname(fixes[0].healedFile);
  healedSource = healedSource.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_m, before, spec, after) => {
    let moved = path.relative(healedDir, path.join(path.dirname(file), spec)).split(path.sep).join("/");
    if (!moved.startsWith(".")) moved = "./" + moved;
    return before + moved + after;
  });

  const header =
    `// 🤖 AUTO-HEALED BY AI on ${new Date().toISOString().slice(0, 10)}\n` +
    `// Original file: ${file}\n` +
    `// Healed tests: ${fixes.map((f) => `"${f.title}"`).join(", ")}\n` +
    `// Review these fixes, then copy them into the original file. Do not edit by hand.\n\n`;

  const healedFile = fixes[0].healedFile;
  fs.mkdirSync(path.dirname(healedFile), { recursive: true });
  fs.writeFileSync(healedFile, header + healedSource);
  console.log(`📝 Wrote ${healedFile}  (${fixes.length} healed test${fixes.length > 1 ? "s" : ""})`);
}

// ---------- 3. Run the healed tests ----------
console.log("\n▶️  Running the healed tests...\n");
// (playwright.config.ts writes this run's results to reports/healed-results.json)
const pw = playwrightCommand();
const run = spawnSync(pw.cmd, [...pw.args, "test", "--project=healed"], { stdio: ["ignore", "inherit", "inherit"] });

// ---------- 4. Record the outcome of each healed test ----------
const stillFailing = run.status === null ? null : readFailedTests("reports/healed-results.json");
for (const h of healings) {
  if (!stillFailing) {
    h.rerunStatus = "not-run";
    continue;
  }
  const failure = stillFailing.find((f) => f.title === h.title);
  h.rerunStatus = failure ? "failed" : "passed";
  if (failure) h.rerunError = failure.error;
}

fs.writeFileSync("reports/healing.json", JSON.stringify({ createdAt: new Date().toISOString(), healings }, null, 2));

const passed = healings.filter((h) => h.rerunStatus === "passed").length;
console.log("─".repeat(60));
console.log(`Healed tests passing after the fix: ${passed}/${healings.length}`);
for (const h of healings) console.log(`${h.rerunStatus === "passed" ? "✅" : "❌"} ${h.title}`);
console.log("Details saved to reports/healing.json");
