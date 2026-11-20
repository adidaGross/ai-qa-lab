// One command for the whole story:
//   Step 0: delete old reports (so only this run's report remains)
//   Step 1: run the main tests (some fail)
//   Step 2: AI analyzes every failure (app bug or test bug?)
//   Step 3: AI-fixed tests are written to tests/healed/ and run again
//   Summary: before vs after, proving the suggested test fixes work
// Run it with:  npm run verify-fixes

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { npmCommand } from "./commands.js";

// Runs one npm command. Returns true if it succeeded.
// quiet = hide the output (used for step 1, where we only need the counts).
function step(number: number, title: string, command: string[], quiet = false): boolean {
  console.log(`\n${"═".repeat(60)}\n STEP ${number}: ${title}\n${"═".repeat(60)}`);
  const npm = npmCommand();
  const result = spawnSync(npm.cmd, [...npm.args, "run", "--silent", ...command], { stdio: quiet ? "ignore" : "inherit", shell: npm.shell });
  return result.status === 0;
}

// Step 0: start fresh, so this run's report never mixes with an older run.
step(0, "Delete old reports", ["clean:reports", "--", "--all"]);

// Step 1: failing tests are EXPECTED here, so we don't stop when tests fail.
// The full errors go into reports/results.json (and the HTML report) for the AI to read.
step(1, "Run the main test suite", ["test"], true);
const main = JSON.parse(fs.readFileSync("reports/results.json", "utf8")).stats;
console.log(`${main.expected} passed, ${main.unexpected} failed  (full details: npm run report)`);

// Steps 2 and 3 must succeed, otherwise there is nothing to verify.
if (!step(2, "AI analyzes the failures", ["ai:analyze"])) {
  console.error("\n❌ AI analysis failed, stopping here.");
  process.exit(1);
}
step(3, "Heal broken tests and run them again", ["ai:heal"]);
step(4, "Build the HTML report", ["ai:report"]);

// ---------- Summary ----------
const analysis = JSON.parse(fs.readFileSync("reports/ai-analysis.json", "utf8"));
const results: any[] = analysis.results;
const appBugs = results.filter((r) => r.analysis?.classification === "app-bug");
const testBugs = results.filter((r) => r.analysis?.classification === "test-bug");

const healings: any[] = fs.existsSync("reports/healing.json")
  ? JSON.parse(fs.readFileSync("reports/healing.json", "utf8")).healings
  : [];
const healedPassing = healings.filter((h) => h.rerunStatus === "passed").length;

console.log(`\n${"═".repeat(60)}\n SUMMARY\n${"═".repeat(60)}`);
console.log(`Main suite:          ${main.expected} passed, ${main.unexpected} failed`);
console.log(`AI found:            ${appBugs.length} app bugs, ${testBugs.length} broken tests`);
console.log(`Healed tests:        ${healedPassing}/${healings.length} pass after the AI fix`);
console.log(
  analysis.aiMode === "max"
    ? `AI cost of this run: $0 API credits (subscription; API equivalent $${analysis.costUsd.toFixed(3)})`
    : `AI cost of this run: $${analysis.costUsd.toFixed(3)} (Claude API)`
);

console.log(`\n🐞 App bugs to fix in the code (suggested fixes in reports/ai-analysis.json):`);
for (const r of appBugs) console.log(`   [${r.analysis.severity}] ${r.analysis.summary}`);

console.log(`\n🔧 Broken tests, BEFORE vs AFTER the AI fix:`);
for (const h of healings) console.log(`   ❌ → ${h.rerunStatus === "passed" ? "✅" : "❌"}  ${h.title}`);

console.log(`\n📊 Full report: reports/ai-report.html`);

const allHealed = healings.length > 0 && healedPassing === healings.length;
console.log(allHealed ? "\n✅ All suggested test fixes are verified working." : "\n⚠️  Some suggested test fixes still fail. Check reports/healing.json.");
process.exit(allHealed ? 0 : 1);
