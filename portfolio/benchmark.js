// Draws the mutation benchmark section from benchmark/basic.json and benchmark/hard.json.
// All text is added with textContent, never innerHTML.

(function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const range = (a) => `${Math.floor(a.low * 100)}–${Math.round(a.high * 100)}%`;

  const LEVELS = {
    basic: { label: "Basic", desc: "One-line changes such as a flipped condition, a changed number, a wrong selector or a wrong expected value." },
    hard: {
      label: "Hard",
      desc: "Changes designed to look like the OTHER kind of problem: subtle app bugs (wrong field, boundary, missing await, weakened validation, statement order) and believable test mistakes (checking a real but wrong element, another real product, a plausible wrong number, swapped steps).",
    },
  };
  const data = {};
  let level = null;
  let configIndex = 0;

  function kpi(value, label, tone) {
    const box = el("div", `kpi ${tone}`);
    box.append(el("b", "", value), el("span", "", label));
    return box;
  }

  function bar(rate) {
    const track = el("div", "op-track");
    const fill = el("div", `op-fill ${rate < 0.8 ? "warn" : ""}`);
    fill.style.width = `${(rate * 100).toFixed(1)}%`;
    track.append(fill);
    return track;
  }

  // "Answered" = how often the model returned a valid answer at all; the tooltip shows
  // its accuracy on the ones it did answer (a reliability problem is not a judgment problem).
  function answeredCell(m) {
    const td = el("td", "", `${m.answerRate.answered}/${m.answerRate.total}`);
    if (m.answerRate.answered < m.answerRate.total) {
      td.title = `${pct(m.accuracyWhenAnswered.rate)} correct when it answered`;
      td.append(el("small", "sub-line", `${pct(m.accuracyWhenAnswered.rate)} right when answered`));
    }
    return td;
  }

  // ---------- replay of the recorded benchmark run ----------
  // Plays back the REAL results (mutants, every AI judgment) step by step. Nothing is re-run.
  let replayToken = 0; // a new replay (or switching level) cancels the old one
  let skipping = false;
  const commandFor = (d) => `npm run bench:${d.settings.level}${d.configs.length > 1 ? ":compare" : ""}`;

  function termLine(text, kind = "", sub = "") {
    const term = $("bench-term");
    const div = el("div", `line ${kind}`, text);
    if (sub) div.append(el("span", "sub", sub));
    term.append(div);
    term.scrollTop = term.scrollHeight;
    return div;
  }

  function resetReplay(d) {
    replayToken++;
    skipping = false;
    $("bench-term-title").textContent = commandFor(d);
    $("bench-term").replaceChildren(el("div", "line dim", `Press the replay button to watch the recorded ${LEVELS[level].label.toLowerCase()} run.`));
    $("bench-run-btn").disabled = false;
    $("bench-run-btn").textContent = `Replay the ${LEVELS[level].label.toLowerCase()} benchmark`;
    $("bench-skip-btn").hidden = true;
  }

  async function replayBenchmark() {
    const d = data[level];
    const token = ++replayToken;
    skipping = false;
    const wait = (ms) => (skipping ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
    const cancelled = () => token !== replayToken;
    $("bench-term").replaceChildren();
    $("bench-run-btn").disabled = true;
    $("bench-run-btn").textContent = "Replaying…";
    $("bench-skip-btn").hidden = false;

    // Phase 0
    termLine("═══ Phase 0: clean baseline (all planted bugs fixed, all broken tests repaired)", "head");
    await wait(500);
    if (cancelled()) return;
    termLine("Baseline passes all tests", "ok");

    // Phase 1: every mutant, caught or not
    termLine(`═══ Phase 1: testing ${d.mutants.length} ${d.settings.level} mutants (from ${d.settings.candidates} candidates, seed ${d.settings.seed})`, "head");
    for (const m of [...d.mutants].sort((a, b) => a.id.localeCompare(b.id))) {
      await wait(45);
      if (cancelled()) return;
      const where = `${m.file}:${m.line}`;
      // A surviving APP change is a gap in the test suite; a surviving TEST change simply had no effect.
      const gap = m.status === "survived" && m.target === "app";
      const label =
        m.status === "killed"
          ? `caught (${m.failingTests.length} test${m.failingTests.length === 1 ? "" : "s"} failed)`
          : gap
            ? "NOT caught (test gap)"
            : m.status === "survived"
              ? "no effect (the test still proves the same thing)"
              : m.status;
      termLine(`${m.id}  ${m.target}/${m.operator}  ${where}  →  ${label}`, gap ? "warn" : m.status === "survived" ? "dim" : "pass");
    }
    const mu = d.mutation;
    termLine(`Mutation score: ${mu.mutationScore.killed}/${mu.mutationScore.total} app changes caught (${pct(mu.mutationScore.rate)})`, "dim");
    await wait(500);

    // Phase 2: every configuration judges every failure
    const mutantById = new Map(d.mutants.map((m) => [m.id, m]));
    for (const c of d.configs) {
      if (cancelled()) return;
      termLine(`═══ Phase 2: ${c.id}: AI triage of ${c.judgments.length} test failures (${c.model}, ${c.context} context)`, "head");
      const progress = termLine("", "progress");
      let right = 0;
      let wrong = 0;
      let shownMistakes = 0;
      for (const j of c.judgments) {
        await wait(22);
        if (cancelled()) return;
        if (j.predicted === j.truth) right++;
        else {
          wrong++;
          if (shownMistakes < 5) {
            shownMistakes++;
            const m = mutantById.get(j.mutantId);
            const said = j.predicted === "error" ? "no valid answer" : `said ${j.predicted}`;
            termLine(`  wrong: ${j.mutantId} ${m ? m.operator : ""}: truth ${j.truth}, AI ${said}`, "fail", j.test);
          }
        }
        progress.textContent = `  judged ${right + wrong}/${c.judgments.length}   ${right} right   ${wrong} wrong`;
      }
      if (wrong > shownMistakes) termLine(`  … and ${wrong - shownMistakes} more mistakes (see the full report)`, "dim");
      const m = c.metrics;
      termLine(
        `  ${c.id}: ${pct(m.accuracy.rate)} accurate (95% range ${range(m.accuracy)}) · avg ${m.avgSeconds ? m.avgSeconds.toFixed(1) + " s" : "–"} · ${c.aiMode === "ollama" ? "local model, $0" : `API cost ${money(c.costUsd)}`}`,
        m.accuracy.rate >= 0.95 ? "ok" : "warn"
      );
      await wait(400);
    }

    // Results
    if (cancelled()) return;
    const totals = costTotals(d);
    termLine("═══ Results", "head");
    for (const c of d.configs) termLine(`${c.id.padEnd(15)} ${pct(c.metrics.accuracy.rate).padStart(6)}   answered ${c.metrics.answerRate.answered}/${c.metrics.answerRate.total}`, "dim");
    termLine(`Took ${duration(d.durationSec)} · ${totals.billed ? `billed ${money(totals.billedUsd)}` : `$0 billed (subscription), API equivalent ${money(totals.listUsd)}`}`, "ok");

    $("bench-skip-btn").hidden = true;
    $("bench-run-btn").disabled = false;
    $("bench-run-btn").textContent = "Replay again";
    await new Promise((r) => setTimeout(r, skipping ? 0 : 600));
    if (cancelled()) return;
    const target = $("bench-compare-panel").hidden ? $("bench-kpis") : $("bench-compare-panel");
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.remove("flash");
    void target.offsetWidth; // restart the highlight animation
    target.classList.add("flash");
  }

  $("bench-run-btn").addEventListener("click", () => level && replayBenchmark());
  $("bench-skip-btn").addEventListener("click", () => (skipping = true));

  // ---------- costs and run details ----------
  const money = (usd) => (usd >= 100 ? `$${Math.round(usd)}` : usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3)}`);
  const duration = (sec) => (sec >= 90 ? `${Math.round(sec / 60)} min` : `${sec} s`);

  // costUsd per configuration is the API LIST PRICE of its calls. On a subscription run
  // (aiMode "max") nothing is billed; on an API run (aiMode "api") that amount is billed.
  function costTotals(d) {
    const listUsd = d.configs.reduce((sum, c) => sum + c.costUsd, 0);
    const billedUsd = d.configs.filter((c) => c.aiMode === "api").reduce((sum, c) => sum + c.costUsd, 0);
    return { listUsd, billedUsd, billed: billedUsd > 0 };
  }

  function renderDetails(d) {
    const mu = d.mutation;
    const app = d.mutants.filter((m) => m.target === "app").length;
    const test = d.mutants.length - app;
    const failures = d.configs[0] ? d.configs[0].judgments.length : 0;
    const calls = d.configs.reduce((sum, c) => sum + c.judgments.length, 0);
    const totals = costTotals(d);
    const niceName = (id) => id.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^\w/, (ch) => ch.toUpperCase());
    const models = [...new Set(d.configs.map((c) => niceName(c.model)))].join(", "); // e.g. "Opus 5.5, Sonnet 5.5"
    const effort = d.configs[0]?.effort ?? "medium";

    const items = [
      ["Mutants", `${d.mutants.length}`, `${app} app · ${test} test · sampled from ${d.settings.candidates} (seed ${d.settings.seed})`],
      ["Caught by the tests", `${mu.mutationScore.killed}/${mu.mutationScore.total} app · ${mu.testMutantsDetected.killed}/${mu.testMutantsDetected.total} test`, `${mu.survivors.length} changed nothing any test checks`],
      ["Test failures judged", `${failures}`, `by each of ${d.configs.length} configuration${d.configs.length === 1 ? "" : "s"}`],
      ["AI calls", `${calls}`, `effort “${effort}”, 4 at a time`],
      ["Total run time", duration(d.durationSec), "tests + all AI configurations"],
      ["Cost", totals.billed ? money(totals.billedUsd) : "$0 billed", totals.billed ? "Claude API" : `Claude subscription · API equivalent ${money(totals.listUsd)}`],
      ["Models", models || "none (AI skipped)", ""],
    ];
    $("bench-details").replaceChildren(
      ...items.map(([label, value, note]) => {
        const box = el("div");
        const dd = el("dd", "", value);
        if (note) dd.append(el("small", "", note));
        box.append(el("dt", "", label), dd);
        return box;
      })
    );
    $("bench-cost-note").textContent = totals.billed
      ? "Costs are what these calls were billed on the Claude API."
      : "This run used a Claude subscription through Claude Code, so nothing was billed. “API cost” is what the same calls would cost at Claude API list prices (per million tokens: Opus 5.5 $4 in / $20 out, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50), as reported by Claude Code. Claude Code adds its own instructions to every call, so a direct API integration would cost less.";
  }

  // ---------- commands for this level, with costs from the recorded run ----------
  function renderCommands(d) {
    const lvl = d.settings.level;
    const opus = d.configs.find((c) => c.id === "opus:full");
    const totals = costTotals(d);
    const sub = (equiv) => (equiv === null ? ["$0", "no AI"] : ["$0 on a subscription", `API equivalent ≈ ${money(equiv)}`]);

    const rows = [
      [`npm run bench:${lvl}`, `${d.mutants.length} ${lvl} mutants, AI triage with Opus 5.5 (full context)`, sub(opus ? opus.costUsd : null)],
      [`npm run bench:${lvl}:compare`, `Same mutants, judged by all 5 configurations (Opus, Sonnet, Haiku × full/minimal context)`, sub(d.configs.length > 1 ? totals.listUsd : null)],
      [`npm run bench:mutation${lvl === "hard" ? ":hard" : ""}`, "Mutation testing only: which changes do the tests catch? (no AI)", sub(null)],
      ["npm run bench:reports", "Rebuild both HTML reports from the saved results", sub(null)],
    ];

    const head = el("thead");
    const hr = el("tr");
    ["Command", "What it does", "AI cost"].forEach((t) => hr.append(el("th", "", t)));
    head.append(hr);
    const body = el("tbody");
    for (const [cmd, what, [cost, note]] of rows) {
      const tr = el("tr");
      const c1 = el("td");
      c1.append(el("code", "", cmd));
      const c3 = el("td", "", cost);
      if (note && note !== "no AI") c3.append(el("small", "", note));
      tr.append(c1, el("td", "", what), c3);
      body.append(tr);
    }
    $("bench-commands").replaceChildren(head, body);
  }

  function renderTabs() {
    const tabs = $("bench-tabs");
    tabs.replaceChildren(
      ...Object.keys(LEVELS)
        .filter((l) => data[l])
        .map((l) => {
          const b = el("button", "", LEVELS[l].label);
          b.type = "button";
          b.setAttribute("role", "tab");
          b.setAttribute("aria-selected", String(l === level));
          b.addEventListener("click", () => {
            level = l;
            configIndex = 0;
            render();
          });
          return b;
        })
    );
  }

  function renderConfigDetails(d) {
    const c = d.configs[configIndex];
    $("bench-cfg-a").textContent = c ? `· ${c.id}` : "";
    $("bench-cfg-b").textContent = c ? `· ${c.id}` : "";
    if (!c) {
      $("bench-confusion").replaceChildren();
      $("bench-operators").replaceChildren(el("p", "panel-sub", "AI triage was not run at this level."));
      return;
    }
    const m = c.metrics;

    // Confusion matrix
    const head = el("thead");
    const hr = el("tr");
    ["", "app bug", "test bug", "other"].forEach((t) => hr.append(el("th", "", t)));
    head.append(hr);
    const body = el("tbody");
    for (const truth of ["app-bug", "test-bug"]) {
      const row = el("tr");
      row.append(el("th", "", truth.replace("-", " ")));
      const x = m.confusion[truth];
      const cells = { "app-bug": x["app-bug"], "test-bug": x["test-bug"], other: x.environment + x.error };
      for (const [label, n] of Object.entries(cells)) row.append(el("td", label === truth ? "hit" : n ? "miss" : "", String(n)));
      body.append(row);
    }
    $("bench-confusion").replaceChildren(head, body);

    // Accuracy per type of change
    const ops = Object.entries(m.byOperator).sort((a, b) => a[0].localeCompare(b[0]));
    $("bench-operators").replaceChildren(
      ...ops.map(([name, g]) => {
        const [kind, op] = name.split(": ");
        const row = el("div", "op-row");
        const label = el("div", "op-name");
        label.append(el("span", "kind", kind), document.createTextNode(op));
        label.title = name;
        row.append(label, bar(g.rate), el("div", "op-val", `${g.correct}/${g.total}`));
        return row;
      })
    );
    document.querySelectorAll("#bench-compare tbody tr").forEach((tr, i) => tr.classList.toggle("selected", i === configIndex));
  }

  function render() {
    const d = data[level];
    renderTabs();
    $("bench-level-desc").textContent = LEVELS[level].desc;
    const when = new Date(d.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" });
    const minutes = Math.max(1, Math.round(d.durationSec / 60));
    const failures = d.configs[0] ? d.configs[0].judgments.length : 0;
    $("bench-note").textContent =
      `Latest run: ${when} · ${d.mutants.length} mutants from ${d.settings.candidates} candidates (seed ${d.settings.seed})` +
      (failures ? ` · ${failures} test failures judged` : "") + ` · ${minutes} min`;
    $("bench-report-link").href = `benchmark/${level}-report.html`;
    resetReplay(d);

    // KPIs of the main configuration (the first one: Opus with full context)
    const main = d.configs[0];
    const mu = d.mutation;
    const kpis = [];
    if (main) {
      const a = main.metrics.accuracy;
      kpis.push(kpi(pct(a.rate), `AI accuracy, ${main.id} (${a.correct}/${a.total}) · 95% range ${range(a)}`, "ok"));
      kpis.push(kpi(`${main.metrics.byTruth["app-bug"].correct}/${main.metrics.byTruth["app-bug"].total}`, "app bugs classified right", "bug"));
      kpis.push(kpi(`${main.metrics.byTruth["test-bug"].correct}/${main.metrics.byTruth["test-bug"].total}`, "test bugs classified right", "test"));
    }
    kpis.push(kpi(pct(mu.mutationScore.rate), `mutation score (${mu.mutationScore.killed}/${mu.mutationScore.total} app changes caught)`, ""));
    if (d.configs.length) {
      const totals = costTotals(d);
      kpis.push(kpi(totals.billed ? money(totals.billedUsd) : "$0", totals.billed ? "billed to the Claude API" : `billed (Claude subscription) · API equivalent ${money(totals.listUsd)}`, ""));
    }
    $("bench-kpis").replaceChildren(...kpis);
    renderDetails(d);
    renderCommands(d);

    // Comparison table (only when several configurations were run)
    const panel = $("bench-compare-panel");
    panel.hidden = d.configs.length < 2;
    if (d.configs.length >= 2) {
      const bestRate = Math.max(...d.configs.map((c) => c.metrics.accuracy.rate));
      const head = el("thead");
      const hr = el("tr");
      ["Model : context", "Accuracy", "95% range", "Answered", "App bugs", "Test bugs", "Avg time", "API cost", "Per 1k failures"].forEach((t) =>
        hr.append(el("th", "", t))
      );
      head.append(hr);
      const body = el("tbody");
      d.configs.forEach((c, i) => {
        const m = c.metrics;
        const row = el("tr");
        const name = el("td");
        name.append(el("b", "", c.id));
        if (m.accuracy.rate === bestRate) name.append(el("span", "best", "BEST"));
        const acc = el("td");
        const wrap = el("div", "acc");
        wrap.append(el("b", "", pct(m.accuracy.rate)), bar(m.accuracy.rate));
        acc.append(wrap);
        row.append(
          name,
          acc,
          el("td", "", range(m.accuracy)),
          answeredCell(m),
          el("td", "", `${m.byTruth["app-bug"].correct}/${m.byTruth["app-bug"].total}`),
          el("td", "", `${m.byTruth["test-bug"].correct}/${m.byTruth["test-bug"].total}`),
          el("td", "num", m.avgSeconds ? `${m.avgSeconds.toFixed(1)} s` : "–"),
          el("td", "num", c.aiMode === "ollama" ? "$0 (local)" : money(c.costUsd)),
          el("td", "num", c.aiMode === "ollama" ? "$0" : m.accuracy.total ? money((c.costUsd / m.accuracy.total) * 1000) : "–")
        );
        row.addEventListener("click", () => {
          configIndex = i;
          renderConfigDetails(d);
        });
        body.append(row);
      });
      $("bench-compare").replaceChildren(head, body);
    }
    renderConfigDetails(d);

    // Test-suite gaps: app changes that no test noticed
    const gaps = mu.survivors.filter((x) => x.target === "app");
    const harmless = mu.survivors.length - gaps.length;
    $("bench-gaps-sub").textContent =
      `${gaps.length} app changes broke nothing that any test checks, so each one is an idea for a new test. ` +
      "These gaps are left in on purpose, to demonstrate that the benchmark detects weaknesses in the test suite, not only in the app." +
      (harmless ? ` (${harmless} test changes also had no effect: they didn't change what the test proves.)` : "");
    $("bench-gaps").replaceChildren(
      ...gaps.map((g) => {
        const box = el("div", "gap");
        const top = el("div", "gap-head");
        top.append(el("span", "gap-tag", g.operator), el("span", "", `${g.file}:${g.line}`));
        const pre = el("pre");
        g.before.split("\n").forEach((l) => pre.append(el("span", "del", `- ${l.trim()}`)));
        g.after.split("\n").forEach((l) => pre.append(el("span", "add", `+ ${l.trim() || "(line removed)"}`)));
        box.append(top, pre);
        return box;
      })
    );
    $("benchmark").hidden = false;
  }

  const load = (l) =>
    fetch(`benchmark/${l}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && (data[l] = d))
      .catch(() => null);

  Promise.all(Object.keys(LEVELS).map(load)).then(() => {
    level = data.hard ? "hard" : data.basic ? "basic" : null; // show the hard level first when it exists
    if (level) render(); // no benchmark at all: the section stays hidden
  });
})();
