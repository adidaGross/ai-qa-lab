// Builds one self-contained HTML report from the JSON results:
//   reports/results.json      (Playwright main run)
//   reports/ai-analysis.json  (AI classification + fixes)
//   reports/healing.json      (healed tests and their re-run)
//   answer-key/*              (optional: AI accuracy score)
// Run it with:  npm run ai:report   -> reports/ai-report.html

import fs from "node:fs";
import { computeScore } from "./scoring.js";

// ---------- Load data ----------
const readJson = (path: string) => (fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : null);
const testRun = readJson("reports/results.json");
const analysis = readJson("reports/ai-analysis.json");
const healing = readJson("reports/healing.json");
if (!testRun || !analysis) {
  console.error('Missing reports. Run "npm test" and "npm run ai:analyze" first.');
  process.exit(1);
}

const results: any[] = analysis.results;
const healings: any[] = healing?.healings ?? [];
const score = computeScore(results);

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];
const appBugs = results
  .filter((r) => r.analysis?.classification === "app-bug")
  .sort((a, b) => SEVERITY_ORDER.indexOf(a.analysis.severity) - SEVERITY_ORDER.indexOf(b.analysis.severity));
const testBugs = results.filter((r) => r.analysis?.classification === "test-bug");
const healedPassing = healings.filter((h) => h.rerunStatus === "passed").length;
const passed = testRun.stats.expected;
const failed = testRun.stats.unexpected;
const total = passed + failed;

// ---------- Safety: escape text before putting it into HTML ----------
// Without this, a test name or error containing "<script>" would RUN in the report.
// (That is exactly bug BUG-009 in our shop!)
function esc(text: unknown): string {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---------- Small building blocks ----------
// The report looks like pages of a QA notebook: a run summary, then one ticket per finding.
const codePair = (beforeTitle: string, before: string, afterTitle: string, after: string) => `
  <div class="code-pair">
    <div><div class="code-title before">${esc(beforeTitle)}</div><pre><code>${esc(before)}</code></pre></div>
    <div><div class="code-title after">${esc(afterTitle)}</div><pre><code>${esc(after)}</code></pre></div>
  </div>`;

const pct = (n: number) => (total ? (n / total) * 100 : 0);
const shortFile = (f: string) => String(f).replace(/^tests\//, "");

// ---------- Sections ----------
const summarySection = `
<section class="sheet">
  <h2><span class="n">01</span> Run summary</h2>
  <dl class="summary">
    <div><dt>tests run</dt><dd>${total} <small>${passed} passed · ${failed} failed</small></dd></div>
    <div><dt>app bugs</dt><dd class="bug">${appBugs.length} <small>real defects in the shop</small></dd></div>
    <div><dt>broken tests</dt><dd class="test">${testBugs.length} <small>problems in the tests</small></dd></div>
    <div><dt>healed</dt><dd class="ok">${healedPassing}/${healings.length} <small>pass after the AI fix</small></dd></div>
    ${score ? `<div><dt>AI accuracy</dt><dd class="ok">${score.correct}/${score.total} <small>vs the answer key</small></dd></div>` : ""}
  </dl>
  <div class="bar" role="img" aria-label="${passed} passed, ${appBugs.length} app bugs, ${testBugs.length} broken tests">
    <span class="seg seg-pass" style="width:${pct(passed)}%"></span>
    <span class="seg seg-bug" style="width:${pct(appBugs.length)}%"></span>
    <span class="seg seg-test" style="width:${pct(testBugs.length)}%"></span>
  </div>
  <p class="legend"><span><i class="key seg-pass"></i>passed ${passed}</span><span><i class="key seg-bug"></i>app bug ${appBugs.length}</span><span><i class="key seg-test"></i>broken test ${testBugs.length}</span></p>
</section>`;

const bugsSection = `
<section class="sheet">
  <h2><span class="n">02</span> App bugs <span class="count">${appBugs.length}</span></h2>
  <p class="lead">The tests were right and the shop is wrong. Sorted by severity, each with the AI's suggested fix. Click a ticket to open it.</p>
  ${appBugs
    .map(
      (r, i) => `
  <details class="ticket">
    <summary>
      <span class="ticket-head"><span class="id">BUG ${String(i + 1).padStart(2, "0")}</span><span class="sev sev-${esc(r.analysis.severity)}">${esc(r.analysis.severity)}</span><span class="cat">${esc(r.analysis.bugCategory)}</span></span>
      <span class="ticket-title">${esc(r.analysis.summary)}</span>
    </summary>
    <div class="ticket-body">
      <p><b>Failing test:</b> “${esc(r.test.title)}” <span class="muted">${esc(shortFile(r.test.file))}:${esc(r.test.line)}</span></p>
      <p><b>Root cause:</b> ${esc(r.analysis.rootCause)}</p>
      <p><b>Evidence:</b> ${esc(r.analysis.evidence)}</p>
      ${r.analysis.appFix ? `<p><b>Suggested fix in</b> <code>${esc(r.analysis.appFix.file)}</code></p>` + codePair("current code", r.analysis.appFix.before, "suggested fix", r.analysis.appFix.after) : ""}
    </div>
  </details>`
    )
    .join("")}
</section>`;

const healedSection = `
<section class="sheet">
  <h2><span class="n">03</span> Repaired tests <span class="count">${healedPassing}/${healings.length} pass</span></h2>
  <p class="lead">The shop was right and the test was wrong. The AI wrote a corrected copy to <code>tests/healed/</code> with the same file and test name, and it was run again. The original tests are not changed: a person reviews the fix first.</p>
  ${healings
    .map(
      (h, i) => `
  <details class="ticket">
    <summary>
      <span class="ticket-head"><span class="id">TEST ${String(i + 1).padStart(2, "0")}</span><span class="${h.rerunStatus === "passed" ? "status-ok" : "status-bad"}">${h.rerunStatus === "passed" ? "failed → passes" : "still failing"}</span></span>
      <span class="ticket-title">${esc(h.title)}</span>
    </summary>
    <div class="ticket-body">
      <p><b>What was wrong:</b> ${esc(h.problem)}</p>
      <p><b>The fix:</b> ${esc(h.fixExplanation)}</p>
      <p><b>Repaired copy:</b> <code>${esc(h.healedFile)}</code> <span class="muted">original: ${esc(h.file)}</span></p>
      <details class="inner"><summary>original error</summary><pre><code>${esc(h.originalError)}</code></pre></details>
      ${codePair("before (broken test)", h.originalCode, "after (AI fix)", h.fixedCode)}
      ${h.rerunError ? `<p><b>Error after the fix:</b></p><pre><code>${esc(h.rerunError)}</code></pre>` : ""}
    </div>
  </details>`
    )
    .join("")}
</section>`;

const scoreSection = !score
  ? ""
  : `
<section class="sheet">
  <h2><span class="n">04</span> Graded against the answer key <span class="count">${score.correct}/${score.total}</span></h2>
  <p class="lead">The bugs and broken tests were planted on purpose and listed in an answer key. The AI never saw it; it is only used afterwards to grade the AI.</p>
  <div class="table-wrap"><table>
    <thead><tr><th></th><th>test</th><th>truth</th><th>AI said</th></tr></thead>
    <tbody>
      ${score.rows
        .map((r) => `<tr><td class="${r.correct ? "right" : "wrong"}">${r.correct ? "✓" : "✗"}</td><td>${esc(r.title)}</td><td>${esc(r.expected)}</td><td>${esc(r.actual)}</td></tr>`)
        .join("")}
    </tbody>
  </table></div>
  <p class="muted small">app bugs found ${score.appBugsFound}/${score.appBugsPlanted} · broken tests found ${score.testBugsFound}/${score.testBugsPlanted} · wrong classifications ${score.total - score.correct}</p>
</section>`;

// ---------- The page ----------
const runDate = new Date(analysis.createdAt);
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI QA Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #fdfcf8; --grid: #efede6; --ink: #23242a; --muted: #6a6c74; --rule: #d9d6cc; --soft: #f3f1ea;
    --pen: #c0392b; --pass: #2e7d4f; --bug: #b3261e; --test: #9a6200; --blue: #2c5aa0;
    --before: #fbe9e7; --before-ink: #9b2c22; --after: #e7f3ea; --after-ink: #22663f;
    --sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #17181c; --grid: #202228; --ink: #e6e4de; --muted: #9c9ea6; --rule: #33353d; --soft: #1f2127;
      --pen: #ff8a7a; --pass: #7cc49a; --bug: #f08a83; --test: #e0b45c; --blue: #8fb3ef;
      --before: #3a2220; --before-ink: #ffb4aa; --after: #1d3326; --after-ink: #9fdcb5;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: var(--ink); font: 15px/1.6 var(--sans); background-color: var(--paper);
    background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 48px; }
  header { padding: 4px 0 8px; }
  header .file { font: 13px var(--mono); color: var(--muted); margin: 0 0 6px; }
  header h1 { font: 600 26px/1.25 var(--sans); margin: 0 0 4px; }
  header p { margin: 0; color: var(--muted); font-size: 14px; }
  .sheet { background: var(--paper); border: 1px solid var(--rule); padding: 18px 20px; margin-top: 18px; }
  h2 { font: 600 17px var(--mono); margin: 0 0 6px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  h2 .n { color: var(--pen); font-weight: 500; }
  .count { font: 500 13px var(--mono); color: var(--muted); }
  .lead { color: var(--muted); margin: 0 0 14px; font-size: 14px; }
  .muted { color: var(--muted); } .small { font-size: 13px; }
  code { font: 13px/1.5 var(--mono); }
  p code { background: var(--soft); padding: 1px 5px; }

  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 20px; margin: 8px 0 14px; }
  .summary dt { font: 12px var(--mono); color: var(--muted); }
  .summary dd { margin: 0; font: 600 24px var(--mono); }
  .summary dd small { display: block; font: 400 12px var(--sans); color: var(--muted); }
  .summary dd.bug { color: var(--bug); } .summary dd.test { color: var(--test); } .summary dd.ok { color: var(--pass); }
  .bar { display: flex; height: 10px; border: 1px solid var(--ink); background: var(--paper); }
  .seg-pass { background: var(--pass); } .seg-bug { background: var(--bug); } .seg-test { background: var(--test); }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; margin: 8px 0 0; font: 12px var(--mono); color: var(--muted); }
  .key { display: inline-block; width: 10px; height: 10px; margin-right: 6px; vertical-align: -1px; border: 1px solid var(--ink); }

  .ticket { border: 1px solid var(--ink); background: var(--paper); margin-bottom: 10px; }
  .ticket > summary { cursor: pointer; list-style: none; display: block; }
  .ticket > summary::-webkit-details-marker { display: none; }
  .ticket-head { display: flex; gap: 12px; align-items: center; padding: 5px 12px; border-bottom: 1px solid var(--ink); font: 12px var(--mono); }
  .ticket-head::after { content: "open +"; margin-left: auto; color: var(--muted); }
  .ticket[open] .ticket-head::after { content: "close −"; }
  .id { font-weight: 600; }
  .sev, .cat { text-transform: lowercase; }
  .sev-critical, .sev-high { color: var(--bug); font-weight: 600; } .sev-medium { color: var(--test); font-weight: 600; } .sev-low { color: var(--muted); }
  .cat { color: var(--blue); }
  .status-ok { color: var(--pass); font-weight: 600; } .status-bad { color: var(--bug); font-weight: 600; }
  .ticket-title { display: block; padding: 8px 12px 9px; font-weight: 600; }
  .ticket-body { padding: 2px 12px 12px; border-top: 1px dashed var(--rule); }
  pre { background: var(--soft); padding: 10px 12px; overflow-x: auto; margin: 0; white-space: pre; border: 1px solid var(--rule); }
  .code-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
  @media (max-width: 760px) { .code-pair { grid-template-columns: 1fr; } }
  .code-pair > div { min-width: 0; }
  .code-title { font: 600 12px var(--mono); padding: 3px 10px; border: 1px solid var(--rule); border-bottom: 0; }
  .code-title.before { background: var(--before); color: var(--before-ink); }
  .code-title.after { background: var(--after); color: var(--after-ink); }
  .inner { margin: 8px 0; } .inner summary { cursor: pointer; color: var(--blue); font: 13px var(--mono); }

  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 7px 10px 7px 0; border-bottom: 1px dashed var(--rule); }
  th { font: 500 12px var(--mono); color: var(--muted); }
  td.right { color: var(--pass); font-weight: 600; } td.wrong { color: var(--bug); font-weight: 600; }
  footer { margin-top: 24px; color: var(--muted); font: 12px var(--mono); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <p class="file">reports/ai-report.html</p>
    <h1>AI QA report: QA Shop</h1>
    <p>${esc(runDate.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))} · model ${esc(analysis.model)} · ${
      analysis.aiMode === "max"
        ? `run with a Claude subscription (API equivalent $${esc(analysis.costUsd.toFixed(3))})`
        : `AI cost $${esc(analysis.costUsd.toFixed(3))}`
    }</p>
  </header>
  ${summarySection}
  ${bugsSection}
  ${healedSection}
  ${scoreSection}
  <footer>generated by ai/report.ts from the Playwright results and the AI's analysis</footer>
</div>
</body>
</html>`;

fs.writeFileSync("reports/ai-report.html", html);
console.log("Report written to reports/ai-report.html");
