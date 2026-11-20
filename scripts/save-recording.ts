// Saves the latest full run as a "recording" for the portfolio website's replay.
//   reads:  reports/results.json, reports/ai-analysis.json, reports/healing.json, reports/ai-report.html
//   writes: portfolio/recording/run.json and portfolio/recording/ai-report.html
// Run it with:  npm run recording:save   (after "npm run verify-fixes")

import fs from "node:fs";
import { computeScore } from "../ai/scoring.js";

const read = (p: string) => {
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}. Run "npm run verify-fixes" first.`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
};
const results = read("reports/results.json");
const analysis = read("reports/ai-analysis.json");
const healing = read("reports/healing.json");

const stripColors = (t: string) => t.replace(/\u001b\[[0-9;]*m/g, "");
const firstLine = (t: string) => stripColors(t).split("\n").find((l) => l.trim()) ?? "";

// Every test of the main run, in file order, with pass/fail and duration
type TestRow = { title: string; file: string; status: string; durationMs: number; error: string };
const tests: TestRow[] = [];
function walk(suite: any) {
  for (const spec of suite.specs ?? []) {
    const r = spec.tests[0]?.results.at(-1);
    tests.push({
      title: spec.title,
      file: `tests/${spec.file}`,
      status: r?.status === "passed" ? "passed" : "failed",
      durationMs: r?.duration ?? 0,
      error: r?.error ? firstLine(r.error.message).slice(0, 160) : "",
    });
  }
  for (const child of suite.suites ?? []) walk(child);
}
results.suites.forEach(walk);

const score = computeScore(analysis.results);

const run = {
  recordedAt: analysis.createdAt,
  model: analysis.model,
  aiMode: analysis.aiMode ?? "api",
  costUsd: analysis.costUsd,
  stats: { passed: results.stats.expected, failed: results.stats.unexpected },
  tests,
  analysis: analysis.results.map((r: any) => ({
    title: r.test.title,
    classification: r.analysis?.classification ?? "error",
    severity: r.analysis?.severity ?? null,
    category: r.analysis?.bugCategory ?? null,
    summary: r.analysis?.summary ?? r.error ?? "",
  })),
  healing: healing.healings.map((h: any) => ({
    title: h.title,
    healedFile: h.healedFile,
    status: h.rerunStatus,
  })),
  score: score ? { correct: score.correct, total: score.total } : null,
};

fs.mkdirSync("portfolio/recording", { recursive: true });
fs.writeFileSync("portfolio/recording/run.json", JSON.stringify(run, null, 2) + "\n");
fs.copyFileSync("reports/ai-report.html", "portfolio/recording/ai-report.html");
console.log(`🎬 Recording saved: ${tests.length} tests, ${run.analysis.length} AI analyses, ${run.healing.length} healed tests`);
