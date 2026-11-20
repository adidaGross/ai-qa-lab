// Compares the AI's classifications with the answer key.
// Shared by score.ts (terminal output) and report.ts (HTML report).

import fs from "node:fs";

export type ScoreRow = { title: string; expected: string; actual: string; correct: boolean };
export type Score = {
  rows: ScoreRow[];
  correct: number;
  total: number;
  appBugsFound: number;
  appBugsPlanted: number;
  testBugsFound: number;
  testBugsPlanted: number;
};

// Returns null when there is no answer key (e.g. on a real project).
export function computeScore(analysisResults: any[]): Score | null {
  const brokenPath = "answer-key/broken-tests-manifest.json";
  const bugsPath = "answer-key/bugs-manifest.json";
  if (!fs.existsSync(brokenPath) || !fs.existsSync(bugsPath)) return null;

  const brokenTests = JSON.parse(fs.readFileSync(brokenPath, "utf8")).brokenTests;
  const plantedBugs = JSON.parse(fs.readFileSync(bugsPath, "utf8")).bugs;

  // Truth: the tests in the broken-tests key are test bugs; every other failure is an app bug.
  const brokenTitles = new Set(brokenTests.map((t: any) => t.test));

  const rows: ScoreRow[] = analysisResults.map((r) => {
    const expected = brokenTitles.has(r.test.title) ? "test-bug" : "app-bug";
    const actual = r.analysis?.classification ?? "error";
    return { title: r.test.title, expected, actual, correct: expected === actual };
  });

  return {
    rows,
    correct: rows.filter((r) => r.correct).length,
    total: rows.length,
    appBugsFound: rows.filter((r) => r.correct && r.expected === "app-bug").length,
    appBugsPlanted: plantedBugs.length,
    testBugsFound: rows.filter((r) => r.correct && r.expected === "test-bug").length,
    testBugsPlanted: brokenTests.length,
  };
}
