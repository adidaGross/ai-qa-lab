// The AI analyzer: for every failed test, ask Claude
//   "Is the APP wrong, or is the TEST wrong?" and get an explanation + a fix.
// The AI logic itself lives in triage.ts (shared with the mutation benchmark).
// Run it with:  npm run ai:analyze   (after "npm test")

import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { describeMode, AI_MODE, MODEL } from "faultwise";
import { QA_SHOP } from "./project.js";
import { readFailedTests } from "./read-results.js";
import { buildSystemPrompt, triageFailure, runWithLimit } from "faultwise";

const APP_FILES = ["site/index.html", "site/app.js", "src/server.ts", "src/account.ts"];
const system = buildSystemPrompt(APP_FILES.map((path) => ({ path, content: fs.readFileSync(path, "utf8") })), QA_SHOP);

const failures = readFailedTests();
console.log(`Found ${failures.length} failed tests. Asking ${describeMode()} to analyze them...\n`);

// We analyze up to 4 tests at the same time to save time.
let totalCost = 0;
const results = await runWithLimit(failures, 4, async (failure) => {
  try {
    const testFile = { path: failure.file, content: fs.readFileSync(failure.file, "utf8") };
    const { data: analysis, costUsd } = await triageFailure(failure, system, testFile);
    totalCost += costUsd;
    const icon = analysis.classification === "app-bug" ? "🐞 APP BUG " : analysis.classification === "test-bug" ? "🔧 TEST BUG" : "🌐 ENV     ";
    console.log(`${icon} | ${failure.title}\n            ${analysis.summary}\n`);
    return { test: failure, analysis };
  } catch (error) {
    const message = error instanceof Anthropic.APIError ? `API error ${error.status}: ${error.message}` : String(error);
    console.log(`⚠️  ERROR    | ${failure.title}\n            ${message}\n`);
    return { test: failure, analysis: null, error: message };
  }
});

fs.mkdirSync("reports", { recursive: true });
fs.writeFileSync(
  "reports/ai-analysis.json",
  JSON.stringify(
    { model: MODEL, aiMode: AI_MODE, billed: AI_MODE === "api", createdAt: new Date().toISOString(), costUsd: totalCost, results },
    null,
    2
  )
);

const count = (c: string) => results.filter((r) => r.analysis?.classification === c).length;
console.log("─".repeat(60));
console.log(`App bugs: ${count("app-bug")}   Test bugs: ${count("test-bug")}   Environment: ${count("environment")}   Errors: ${results.filter((r) => !r.analysis).length}`);
console.log(
  AI_MODE === "api"
    ? `Estimated API cost of this run: $${totalCost.toFixed(3)}`
    : `API credits used: $0 (covered by your subscription; API equivalent would be $${totalCost.toFixed(3)})`
);
console.log(`Full details saved to reports/ai-analysis.json`);
