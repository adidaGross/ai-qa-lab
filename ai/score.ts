// Scores the AI against the answer key: did it classify each failure correctly?
// The AI never sees the answer key; only this script does, AFTER the analysis.
// Run it with:  npm run ai:score

import fs from "node:fs";
import { computeScore } from "./scoring.js";

const analysis = JSON.parse(fs.readFileSync("reports/ai-analysis.json", "utf8"));
const score = computeScore(analysis.results);
if (!score) {
  console.log("No answer key found in answer-key/, so there is nothing to score against.");
  process.exit(0);
}

for (const r of score.rows) {
  console.log(`${r.correct ? "✅" : "❌"} ${r.title.padEnd(50)} expected ${r.expected.padEnd(9)} AI said ${r.actual}`);
}
console.log("─".repeat(60));
console.log(`Classification accuracy: ${score.correct}/${score.total} (${Math.round((score.correct / score.total) * 100)}%)`);
console.log(`Planted app bugs found:  ${score.appBugsFound}/${score.appBugsPlanted}`);
console.log(`Broken tests found:      ${score.testBugsFound}/${score.testBugsPlanted}`);
console.log(`Wrong classifications:   ${score.total - score.correct}`);
