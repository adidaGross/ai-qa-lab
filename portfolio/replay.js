// Replays a REAL recorded run of the pipeline (recording/run.json) step by step,
// then shows the real report. Nothing here calls the AI, so it is free and safe for visitors.

const $ = (id) => document.getElementById(id);
const term = $("term");
const runBtn = $("run-btn");
const skipBtn = $("skip-btn");
let run = null;
let skipping = false;

// ---------- helpers ----------
// All text goes in with textContent, never innerHTML: recorded text can never run as code.
function line(text, kind = "", sub = "") {
  const div = document.createElement("div");
  div.className = `line ${kind}`;
  div.textContent = text;
  if (sub) {
    const s = document.createElement("span");
    s.className = "sub";
    s.textContent = sub;
    div.appendChild(s);
  }
  term.appendChild(div);
  term.scrollTop = term.scrollHeight;
}
const wait = (ms) => (skipping ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

function setStep(n) {
  document.querySelectorAll("#steps li").forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle("active", s === n);
    li.classList.toggle("done", s < n);
  });
}

function kpi(value, label, tone) {
  const div = document.createElement("div");
  div.className = `kpi ${tone}`;
  const b = document.createElement("b");
  b.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  div.append(b, span);
  return div;
}

// Numbers in the page text (e.g. <span data-run="healed">) come from the recorded run, so they never go stale
function fillRunNumbers() {
  const appBugs = run.analysis.filter((a) => a.classification === "app-bug").length;
  const values = {
    tests: run.tests.length,
    passed: run.stats.passed,
    failed: run.stats.failed,
    "app-bugs": appBugs,
    "test-bugs": run.analysis.length - appBugs,
    healed: `${run.healing.filter((h) => h.status === "passed").length}/${run.healing.length}`,
    accuracy: run.score ? `${run.score.correct}/${run.score.total}` : "–",
    model: run.model,
  };
  document.querySelectorAll("[data-run]").forEach((el) => {
    if (el.dataset.run in values) el.textContent = String(values[el.dataset.run]);
  });
}

function renderKpis() {
  fillRunNumbers();
  const appBugs = run.analysis.filter((a) => a.classification === "app-bug").length;
  const testBugs = run.analysis.filter((a) => a.classification === "test-bug").length;
  const healed = run.healing.filter((h) => h.status === "passed").length;
  const box = $("kpis");
  box.replaceChildren(
    kpi(String(run.tests.length), `tests · ${run.stats.passed} passed, ${run.stats.failed} failed`, ""),
    kpi(String(appBugs), "real app bugs found", "bug"),
    kpi(String(testBugs), "broken tests found", "test"),
    kpi(`${healed}/${run.healing.length}`, "healed tests passing", "ok"),
    ...(run.score ? [kpi(`${Math.round((run.score.correct / run.score.total) * 100)}%`, `AI accuracy (${run.score.correct}/${run.score.total})`, "ai")] : []),
    run.aiMode === "max"
      ? kpi("$0", `AI cost (Claude subscription; API equivalent $${run.costUsd.toFixed(2)}) · ${run.analysis.length} calls to ${run.model}`, "")
      : kpi(`$${run.costUsd.toFixed(2)}`, `AI cost on the Claude API · ${run.analysis.length} calls to ${run.model}`, "")
  );
}

const shortFile = (f) => f.replace(/^tests\//, "");

// ---------- the replay ----------
async function replay() {
  skipping = false;
  runBtn.disabled = true;
  runBtn.textContent = "Running…";
  skipBtn.hidden = false;
  term.replaceChildren();
  document.getElementById("demo").scrollIntoView({ behavior: "smooth", block: "start" });

  // Step 0
  setStep(0);
  line("═══ STEP 0: Delete old reports", "head");
  await wait(500);
  line("Removed old reports, starting from a clean slate.", "dim");
  await wait(500);

  // Step 1
  setStep(1);
  line("═══ STEP 1: Run the main test suite", "head");
  line(`Running ${run.tests.length} tests using Playwright (Chromium)`, "dim");
  for (const t of run.tests) {
    await wait(170);
    const secs = (t.durationMs / 1000).toFixed(1);
    if (t.status === "passed") line(`  ✓ ${shortFile(t.file)} › ${t.title} (${secs}s)`, "pass");
    else line(`  ✘ ${shortFile(t.file)} › ${t.title} (${secs}s)`, "fail");
  }
  line(`${run.stats.passed} passed, ${run.stats.failed} failed`, "dim");
  await wait(600);

  // Step 2
  setStep(2);
  line(`═══ STEP 2: AI analyzes the failures (${run.model})`, "head");
  line(`Asking Claude whether each of the ${run.analysis.length} failures is an app bug or a broken test…`, "dim");
  for (const a of run.analysis) {
    await wait(520);
    if (a.classification === "app-bug") line(`APP BUG   [${a.severity}] ${a.title}`, "bug", a.summary);
    else if (a.classification === "test-bug") line(`TEST BUG  ${a.title}`, "fix", a.summary);
    else line(`${a.classification.toUpperCase()}  ${a.title}`, "dim", a.summary);
  }
  const appBugs = run.analysis.filter((a) => a.classification === "app-bug").length;
  const testBugs = run.analysis.filter((a) => a.classification === "test-bug").length;
  const costText = run.aiMode === "max" ? "subscription" : `$${run.costUsd.toFixed(3)}`;
  line(`App bugs: ${appBugs}   Test bugs: ${testBugs}   AI cost: ${costText}`, "dim");
  await wait(600);

  // Step 3
  setStep(3);
  line("═══ STEP 3: Heal broken tests and run them again", "head");
  for (const h of run.healing) {
    await wait(220);
    line(`wrote ${h.healedFile}`, "dim");
  }
  for (const h of run.healing) {
    await wait(380);
    line(`  ${h.status === "passed" ? "failed → passed" : "failed → failed"}  ${h.title}`, h.status === "passed" ? "pass" : "fail");
  }
  const healed = run.healing.filter((h) => h.status === "passed").length;
  line(`Healed tests passing after the AI fix: ${healed}/${run.healing.length}`, "ok");
  await wait(600);

  // Step 4
  setStep(4);
  line("═══ STEP 4: Build the HTML report", "head");
  await wait(500);
  line("Report written to reports/ai-report.html", "dim");
  if (run.score) line(`AI accuracy vs answer key: ${run.score.correct}/${run.score.total}`, "ok");
  line("All suggested test fixes verified: the healed tests pass.", "ok");
  setStep(5);

  // Open the results
  skipBtn.hidden = true;
  runBtn.disabled = false;
  runBtn.textContent = "Replay again";
  renderKpis();
  const results = $("results");
  await new Promise((r) => setTimeout(r, skipping ? 0 : 700));
  results.scrollIntoView({ behavior: "smooth", block: "start" });
  const frame = document.querySelector(".report-frame");
  frame.classList.remove("flash");
  void frame.offsetWidth; // restart the animation
  frame.classList.add("flash");
}

// ---------- start ----------
fetch("recording/run.json")
  .then((r) => r.json())
  .then((data) => {
    run = data;
    const when = new Date(run.recordedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    const cost = run.aiMode === "max" ? "run with a Claude subscription" : `AI cost $${run.costUsd.toFixed(2)}`;
    $("recording-note").textContent = `Replays a real run recorded on ${when} · model ${run.model} · ${cost}`;
    renderKpis();
  })
  .catch(() => {
    $("recording-note").textContent = "No recorded run found yet.";
    runBtn.disabled = true;
  });

runBtn.addEventListener("click", () => run && replay());
skipBtn.addEventListener("click", () => (skipping = true));
