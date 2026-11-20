// Builds benchmark/results/<level>-report.html from benchmark/results/<level>.json
// Run it with:  npm run bench:report -- --level hard   (runs automatically at the end of "npm run bench")

import fs from "node:fs";
import { computeAiMetrics } from "./metrics.js";

const i = process.argv.lastIndexOf("--level");
const level = i > 0 ? process.argv[i + 1] : "basic";
const file = `benchmark/results/${level}.json`;
const data = JSON.parse(fs.readFileSync(file, "utf8"));

// Always recompute the AI metrics from the raw judgments, so older result files get new
// measures too (e.g. answer rate). The judgments themselves are never changed.
for (const c of data.configs) c.metrics = computeAiMetrics(c.judgments);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
const s = data.settings;
const mu = data.mutation;
const configs: any[] = data.configs;

// Escape all text before putting it in HTML (same rule as the main report).
const esc = (t: unknown) =>
  String(t ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const kpi = (label: string, value: string, note: string, tone = "") =>
  `<div class="kpi ${tone}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-note">${esc(note)}</div></div>`;

const diff = (before: string, after: string) =>
  `<pre class="diff">${before.split("\n").map((l) => `<span class="del">- ${esc(l.trim())}</span>`).join("\n")}\n${after
    .split("\n")
    .map((l) => `<span class="add">+ ${esc(l.trim() || "(line removed)")}</span>`)
    .join("\n")}</pre>`;

const bars = (groups: Record<string, { correct: number; total: number; rate: number }>) =>
  Object.entries(groups)
    .sort((a, b) => a[1].rate - b[1].rate || b[1].total - a[1].total)
    .map(
      ([name, g]) => `
    <div class="bar-row"><div class="bar-label">${esc(name)}</div>
      <div class="bar-track"><div class="bar-fill ${g.rate < 0.8 ? "warn" : ""}" style="width:${(g.rate * 100).toFixed(1)}%"></div></div>
      <div class="bar-value">${g.correct}/${g.total}</div></div>`
    )
    .join("");

const confusionTable = (c: any) => `
  <div class="table-wrap"><table class="confusion">
    <thead><tr><th>Truth ↓ / AI said →</th><th>app bug</th><th>test bug</th><th>environment</th><th>error</th></tr></thead>
    <tbody>${(["app-bug", "test-bug"] as const)
      .map(
        (truth) =>
          `<tr><th>${truth.replace("-", " ")}</th>${["app-bug", "test-bug", "environment", "error"]
            .map((p) => `<td class="${p === truth ? "hit" : c[truth][p] ? "miss" : ""}">${c[truth][p]}</td>`)
            .join("")}</tr>`
      )
      .join("")}</tbody></table></div>`;

const mutantById = new Map<string, any>(data.mutants.map((x: any) => [x.id, x]));
const money = (usd: number) => (usd >= 100 ? `$${Math.round(usd)}` : usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3)}`);
const duration = (sec: number) => (sec >= 90 ? `${Math.round(sec / 60)} min` : `${sec} s`);
const costText = (c: any) =>
  c.aiMode === "api" ? money(c.costUsd)
  : c.aiMode === "ollama" ? "$0 (local model)"
  : c.aiMode === "openai" ? "not tracked"
  : `$0 billed (API equiv. ${money(c.costUsd)})`;

// ---------- run details: what was tested, how long, what it cost ----------
const appMutants = data.mutants.filter((x: any) => x.target === "app").length;
const listUsd = configs.reduce((sum, c) => sum + c.costUsd, 0);
const billedUsd = configs.filter((c) => c.aiMode === "api").reduce((sum, c) => sum + c.costUsd, 0);
const calls = configs.reduce((sum, c) => sum + c.judgments.length, 0);
const detail = (label: string, value: string, note = "") =>
  `<div><dt>${esc(label)}</dt><dd>${esc(value)}${note ? `<small>${esc(note)}</small>` : ""}</dd></div>`;
const runDetails = `
  <h2>Run details</h2>
  <dl class="details">
    ${detail("Mutants", String(data.mutants.length), `${appMutants} app · ${data.mutants.length - appMutants} test · from ${s.candidates} candidates (seed ${s.seed})`)}
    ${detail("Caught by the tests", `${mu.mutationScore.killed}/${mu.mutationScore.total} app · ${mu.testMutantsDetected.killed}/${mu.testMutantsDetected.total} test`, `${mu.survivors.length} changed nothing any test checks`)}
    ${detail("Test failures judged", String(configs[0]?.judgments.length ?? 0), `by each of ${configs.length} configuration(s)`)}
    ${detail("AI calls", String(calls), `effort "${configs[0]?.effort ?? "medium"}", 4 at a time`)}
    ${detail("Total run time", duration(data.durationSec), "tests + all AI configurations")}
    ${detail("Cost", billedUsd > 0 ? money(billedUsd) : "$0 billed", billedUsd > 0 ? "Claude API" : `Claude subscription · API equivalent ${money(listUsd)}`)}
  </dl>
  <p class="muted small">${
    billedUsd > 0
      ? "Costs are what these calls were billed on the Claude API."
      : "Run on a Claude subscription through Claude Code, so nothing was billed. API cost = what the same calls would cost at Claude API list prices (per million tokens: Opus 5.5 $4 in / $20 out, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50), as reported by Claude Code. Claude Code adds its own instructions to every call, so a direct API integration would cost less."
  }</p>`;

const comparison = configs.length
  ? `
  <h2>Configurations compared</h2>
  <p class="lead">The same ${configs[0].judgments.length} test failures, judged by each model, with the app's code ("full" context) or with only the test and the error ("minimal" context). <b>Accuracy</b> counts every failure; a call that returned no valid answer counts as wrong. <b>Answered</b> and <b>accuracy when answered</b> separate a model's reliability from its judgment.</p>
  <div class="table-wrap"><table>
    <thead><tr><th>Config</th><th>Accuracy</th><th>95% range</th><th>Answered</th><th>Accuracy when answered</th><th>App bugs</th><th>Test bugs</th><th>Avg time</th><th>Cost</th><th>Per 1,000 failures</th></tr></thead>
    <tbody>${configs
      .map((c) => {
        const m = c.metrics;
        return `<tr><td><b>${esc(c.id)}</b></td><td><b>${pct(m.accuracy.rate)}</b> (${m.accuracy.correct}/${m.accuracy.total})</td><td>${pct(m.accuracy.low)}–${pct(m.accuracy.high)}</td>
          <td>${m.answerRate.answered}/${m.answerRate.total}</td><td>${pct(m.accuracyWhenAnswered.rate)} (${m.accuracyWhenAnswered.correct}/${m.accuracyWhenAnswered.total})</td>
          <td>${m.byTruth["app-bug"].correct}/${m.byTruth["app-bug"].total}</td><td>${m.byTruth["test-bug"].correct}/${m.byTruth["test-bug"].total}</td>
          <td>${m.avgSeconds ? `${m.avgSeconds.toFixed(1)} s` : "–"}</td>
          <td>${esc(costText(c))}</td><td>${m.accuracy.total ? money((c.costUsd / m.accuracy.total) * 1000) : "–"}</td></tr>`;
      })
      .join("")}</tbody></table></div>`
  : `<p class="lead"><b>AI triage was skipped</b> in this run (--skip-ai); only the mutation testing results are shown.</p>`;

const details = configs
  .map((c, index) => {
    const wrong = c.judgments.filter((j: any) => j.predicted !== j.truth);
    return `
  <details class="config" ${index === 0 ? "open" : ""}>
    <summary><b>${esc(c.id)}</b>: ${pct(c.metrics.accuracy.rate)} accurate, ${wrong.length} mistake${wrong.length === 1 ? "" : "s"}</summary>
    <h3>Confusion matrix</h3>${confusionTable(c.metrics.confusion)}
    <h3>Accuracy by type of change</h3><div class="card">${bars(c.metrics.byOperator)}</div>
    <h3>Accuracy by the confidence the AI reported</h3><div class="card">${bars(c.metrics.byConfidence)}</div>
    <h3>Mistakes (${wrong.length})</h3>
    ${
      wrong.length === 0
        ? `<p class="lead">None.</p>`
        : wrong
            .map((j: any) => {
              const m = mutantById.get(j.mutantId);
              return `<div class="item"><span class="tag">${esc(j.mutantId)}</span><span class="tag">${esc(j.target)}: ${esc(j.operator)}</span>
                <div><b>Truth:</b> ${esc(j.truth)} · <b>AI said:</b> ${esc(j.predicted)} (${esc(j.confidence ?? "n/a")}) · test “${esc(j.test)}”</div>
                <div class="muted">${esc(j.summary)}</div>${diff(m.before, m.after)}<div class="muted">${esc(m.file)}:${m.line}</div></div>`;
            })
            .join("")
    }
  </details>`;
  })
  .join("");

const best = configs[0];
const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mutation Benchmark (${esc(level)})</title>
<style>
  :root { --bg:#f6f7f9; --surface:#fff; --text:#1d2330; --muted:#5d6676; --border:#e3e6eb; --code:#f1f3f6; --accent:#3b5bff; --ok:#2e9d5b; --bad:#d64545; --warn:#d98a1c; --del:#fdecec; --add:#e8f6ee; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#12151b; --surface:#1b2029; --text:#e6e9ef; --muted:#9aa3b2; --border:#2c3340; --code:#151a22; --accent:#7b93ff; --ok:#3fb871; --bad:#ef6b6b; --warn:#f0a540; --del:#3a1e22; --add:#18332a; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif; }
  .wrap { max-width:1040px; margin:0 auto; padding:32px 16px 64px; }
  h1 { margin:0 0 4px; font-size:28px; } h2 { font-size:20px; margin:36px 0 6px; } h3 { font-size:16px; margin:20px 0 8px; }
  .muted, .lead { color:var(--muted); } .lead { margin:0 0 14px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-top:20px; }
  .kpi { background:var(--surface); border:1px solid var(--border); border-top:4px solid var(--accent); border-radius:12px; padding:14px 16px; }
  .kpi.ok { border-top-color:var(--ok); } .kpi.warn { border-top-color:var(--warn); }
  .kpi-label, .kpi-note { color:var(--muted); font-size:13px; } .kpi-value { font-size:30px; font-weight:700; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; }
  .bar-row { display:grid; grid-template-columns:minmax(120px,240px) 1fr 56px; gap:10px; align-items:center; margin:6px 0; font-size:14px; }
  .bar-track { height:12px; background:var(--code); border-radius:999px; overflow:hidden; }
  .bar-fill { height:100%; background:var(--ok); border-radius:999px; } .bar-fill.warn { background:var(--warn); }
  .bar-value { text-align:right; font-variant-numeric:tabular-nums; color:var(--muted); }
  .table-wrap { overflow-x:auto; background:var(--surface); border:1px solid var(--border); border-radius:12px; }
  table { border-collapse:collapse; width:100%; font-size:14px; } th, td { padding:8px 12px; border-bottom:1px solid var(--border); text-align:left; }
  .confusion td { text-align:center; font-weight:700; font-variant-numeric:tabular-nums; } .confusion td.hit { color:var(--ok); } .confusion td.miss { color:var(--bad); }
  .config { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 16px; margin-bottom:12px; }
  .config > summary { cursor:pointer; font-size:16px; }
  .item { background:var(--bg); border:1px solid var(--border); border-radius:12px; padding:12px 16px; margin-bottom:10px; }
  .tag { font-size:12px; font-weight:700; border-radius:6px; padding:2px 8px; background:var(--code); color:var(--muted); margin-right:6px; }
  pre.diff { background:var(--code); border-radius:8px; padding:10px 12px; overflow-x:auto; margin:8px 0 0; font:13px/1.5 ui-monospace,Menlo,monospace; }
  .del { background:var(--del); display:inline-block; min-width:100%; } .add { background:var(--add); display:inline-block; min-width:100%; }
  details.all summary { cursor:pointer; color:var(--accent); }
  dl.details { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px 20px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; margin:0; }
  dl.details dt { color:var(--muted); font-size:13px; } dl.details dd { margin:2px 0 0; font-weight:600; }
  dl.details dd small { display:block; color:var(--muted); font-weight:400; font-size:13px; }
  .small { font-size:13px; }
</style></head>
<body><div class="wrap">
  <h1>Mutation Benchmark: ${esc(level)} level</h1>
  <p class="muted">${esc(new Date(data.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))} · ${data.mutants.length} mutants from ${s.candidates} candidates (seed ${s.seed}) · ${data.durationSec >= 60 ? Math.round(data.durationSec / 60) + " min" : data.durationSec + " s"}</p>

  <p class="lead">Starting from a clean version of the shop (all planted bugs fixed, all tests passing), each mutant adds one small change, either to the app (truth: <i>app bug</i>) or to a test (truth: <i>test bug</i>).${
    level === "hard"
      ? " <b>Hard level:</b> the changes are designed to look like the other kind of problem: subtle app bugs (wrong field, boundary, missing await, weakened validation, order of statements) and plausible test mistakes (checking a real but wrong element, using another real product, a believable wrong number, swapped steps)."
      : ""
  } The AI triages every failure without knowing the truth.</p>

  <div class="kpis">
    ${best ? kpi(`AI accuracy (${best.id})`, pct(best.metrics.accuracy.rate), `${best.metrics.accuracy.correct}/${best.metrics.accuracy.total} · 95% range ${pct(best.metrics.accuracy.low)}–${pct(best.metrics.accuracy.high)}`, "ok") : ""}
    ${kpi("Mutation score", pct(mu.mutationScore.rate), `${mu.mutationScore.killed}/${mu.mutationScore.total} app changes caught by the tests`, mu.mutationScore.rate < 0.8 ? "warn" : "ok")}
    ${kpi("Test changes detected", `${mu.testMutantsDetected.killed}/${mu.testMutantsDetected.total}`, "test mutants that made a test fail")}
  </div>

  ${runDetails}
  ${comparison}
  ${configs.length ? `<h2>Details per configuration</h2>${details}` : ""}

  <h2>Gaps in the test suite <span class="muted">(${mu.survivors.filter((x: any) => x.target === "app").length} app changes not caught)</span></h2>
  <p class="lead">These app changes broke nothing that any test checks. Each one is an idea for a new test. These gaps are left in on purpose, to demonstrate that the benchmark detects weaknesses in the test suite, not only in the app.</p>
  ${mu.survivors
    .filter((x: any) => x.target === "app")
    .map((x: any) => `<div class="item"><span class="tag">${esc(x.id)}</span><span class="tag">${esc(x.operator)}</span><span class="muted">${esc(x.file)}:${x.line}</span>${diff(x.before, x.after)}</div>`)
    .join("")}

  <h2>All mutants</h2>
  <details class="all"><summary>Show all ${data.mutants.length}</summary>
  <div class="table-wrap" style="margin-top:10px"><table>
    <thead><tr><th>ID</th><th>Change</th><th>Where</th><th>Tests</th></tr></thead>
    <tbody>${data.mutants
      .map((x: any) => `<tr><td>${esc(x.id)}</td><td>${esc(x.target)}: ${esc(x.operator)}</td><td>${esc(x.file)}:${x.line}</td><td>${esc(x.status)}${x.failingTests.length ? ` (${x.failingTests.length} failed)` : ""}</td></tr>`)
      .join("")}</tbody>
  </table></div></details>
</div></body></html>`;

fs.writeFileSync(`benchmark/results/${level}-report.html`, html);
console.log(`📊 Benchmark report written to benchmark/results/${level}-report.html`);
