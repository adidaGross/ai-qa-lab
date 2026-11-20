// The mutation benchmark.
//   Phase 0: check the clean baseline (all bugs fixed) passes all tests
//   Phase 1: create mutants (one small change each) and run the tests on every mutant
//   Phase 2: the AI triages every test failure, once per configuration (model + context)
//   Phase 3: grade every configuration against the known truth and save the results
//
// Run it with:  npm run bench -- --level hard --cases 60 --configs opus:full,sonnet:full,haiku:full,opus:minimal
// Options:
//   --level basic|hard   which mutation operators (hard = changes that look like the other kind of bug)
//   --cases N            how many mutants (half app, half test)            default 60
//   --seed S             which random sample (same seed = same mutants)    default 42
//   --configs LIST       model:context pairs; model = opus|sonnet|haiku,
//                        context = full (app code included) | minimal (test + error only)   default opus:full
//   --skip-ai            only mutation testing, no AI
//   --lanes L            mutants tested at the same time                   default 3

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { playwrightCommand } from "../ai/commands.js";
import { cleanSources, writeWorkspace } from "./baseline.js";
import { generateMutants, sampleMutants, applyMutant, Mutant, Level } from "./mutators.js";
import { readFailedTests, FailedTest } from "../ai/read-results.js";
import { buildSystemPrompt, triageFailure, runWithLimit } from "ai-qa";
import { MODELS, resolveModel } from "ai-qa";
import { QA_SHOP } from "../ai/project.js";
import { computeMutationMetrics, computeAiMetrics, Judgment } from "./metrics.js";

// ---------- options ----------
const option = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const LEVEL = (option("level") ?? "basic") as Level;
const CASES = Number(option("cases") ?? 60);
const SEED = Number(option("seed") ?? 42);
const LANES = Number(option("lanes") ?? 3);
const SKIP_AI = process.argv.includes("--skip-ai");
// A config is model:context, e.g. opus:full, haiku:minimal, or another vendor's model with its
// mode in front: ollama/gpt-oss:20b:full, openai/gpt-5-mini:minimal  (context defaults to full)
const CONFIGS = (option("configs") ?? "opus:full").split(",").map((c) => {
  const match = c.match(/^(.+?)(?::(full|minimal))?$/)!;
  const name = match[1];
  const context = (match[2] ?? "full") as "full" | "minimal";
  if (!MODELS[name] && !name.includes("/")) throw new Error(`Unknown config "${c}". Use e.g. opus:full, haiku:minimal or ollama/gpt-oss:20b:full`);
  const model = MODELS[name] ?? name;
  return { id: `${name}:${context}`, modelName: name, model, aiMode: resolveModel(model).mode, context };
});
if (!["basic", "hard"].includes(LEVEL)) throw new Error('--level must be "basic" or "hard"');

const AI_FILES = ["site/index.html", "site/app.js", "src/server.ts", "src/account.ts"]; // what the AI gets in "full" context
const OUT_DIR = "benchmark/results";
const started = Date.now();

// ---------- run the test suite on one workspace ----------
type SuiteResult = { ran: boolean; failures: FailedTest[]; passed: number; failed: number };

function runSuite(dir: string, port: number): Promise<SuiteResult> {
  fs.rmSync(path.join(dir, "results.json"), { force: true });
  return new Promise((resolve) => {
    const pw = playwrightCommand();
    const child = spawn(pw.cmd, [...pw.args, "test", "--config", "benchmark/playwright.bench.config.ts"], {
      env: { ...process.env, BENCH_DIR: dir, BENCH_PORT: String(port) },
      stdio: "ignore",
    });
    child.on("close", () => {
      const report = path.join(dir, "results.json");
      if (!fs.existsSync(report)) return resolve({ ran: false, failures: [], passed: 0, failed: 0 });
      const stats = JSON.parse(fs.readFileSync(report, "utf8")).stats;
      resolve({ ran: true, failures: readFailedTests(report), passed: stats.expected, failed: stats.unexpected });
    });
  });
}

// ---------- Phase 0: clean baseline ----------
console.log(`\n═══ Phase 0: clean baseline (all planted bugs fixed, all broken tests repaired)`);
const clean = cleanSources();
writeWorkspace(".bench/lane-0", clean);
const baseline = await runSuite(".bench/lane-0", 3100);
if (!baseline.ran || baseline.failed > 0) {
  console.error(`❌ The clean baseline must pass all tests, but: ${baseline.ran ? baseline.failures.map((f) => f.title).join(", ") : "the suite did not run"}`);
  process.exit(1);
}
console.log(`✅ Baseline passes: ${baseline.passed}/${baseline.passed} tests`);

// ---------- Phase 1: mutants ----------
const candidates = generateMutants(clean, LEVEL);
const mutants = sampleMutants(candidates, CASES, SEED);
console.log(`\n═══ Phase 1: testing ${mutants.length} ${LEVEL} mutants (sampled from ${candidates.length} candidates, seed ${SEED})`);
if (mutants.length < CASES) console.log(`   (asked for ${CASES}, but there are not enough candidates of each kind for more)`);

type MutantResult = Mutant & { status: "killed" | "survived" | "crashed"; failures: FailedTest[]; sources: Record<string, string> };

const mutantResults = await runWithLimit(mutants, LANES, async (m, i): Promise<MutantResult> => {
  const dir = `.bench/${m.id}`; // every mutant gets its own folder and port
  const sources = applyMutant(clean, m);
  writeWorkspace(dir, sources);
  const result = await runSuite(dir, 3101 + (i % 50));
  fs.rmSync(dir, { recursive: true, force: true });

  const status = !result.ran ? "crashed" : result.failed > 0 ? "killed" : "survived";
  const label = status === "killed" ? `killed (${result.failed} test${result.failed > 1 ? "s" : ""} failed)` : status;
  console.log(`${m.id} ${(m.target + "/" + m.operator).padEnd(30)} ${`${m.file}:${m.line}`.padEnd(32)} ${label}`);
  return { ...m, status, failures: result.failures, sources };
});

// ---------- Phase 2: AI triage, per configuration ----------
const failures = mutantResults.flatMap((mutant) => mutant.failures.map((failure) => ({ mutant, failure })));
const configResults: { id: string; model: string; context: string; aiMode: string; effort: string; costUsd: number; phaseSec: number; judgments: Judgment[] }[] = [];

if (SKIP_AI) {
  console.log(`\n═══ Phase 2: skipped (--skip-ai)`);
} else {
  for (const config of CONFIGS) {
    console.log(`\n═══ Phase 2: ${config.id}: AI triage of ${failures.length} test failures (${config.model}, ${config.context} context, ${config.aiMode === "max" ? "subscription" : config.aiMode === "api" ? "API" : config.aiMode})`);
    const judgments: Judgment[] = [];
    let costUsd = 0;
    let done = 0;
    const phaseStart = Date.now();
    await runWithLimit(failures, 4, async ({ mutant, failure }) => {
      const appFiles = config.context === "full" ? AI_FILES.map((p) => ({ path: p, content: mutant.sources[p] })) : [];
      const system = buildSystemPrompt(appFiles, QA_SHOP);
      const testFile = { path: failure.file, content: mutant.sources[failure.file] };
      let predicted: Judgment["predicted"] = "error";
      let confidence: Judgment["confidence"] = null;
      let summary = "";
      let durationMs = 0;
      try {
        const answer = await triageFailure(failure, system, testFile, config.model);
        costUsd += answer.costUsd;
        durationMs = answer.durationMs;
        predicted = answer.data.classification;
        confidence = answer.data.confidence;
        summary = answer.data.summary;
      } catch (error) {
        summary = String(error).slice(0, 300);
      }
      judgments.push({ mutantId: mutant.id, target: mutant.target, operator: mutant.operator, test: failure.title, truth: mutant.truth, predicted, confidence, summary, durationMs });
      done++;
      const ok = predicted === mutant.truth ? "✅" : "❌";
      console.log(`${ok} [${done}/${failures.length}] ${mutant.id} truth ${mutant.truth.padEnd(8)} AI ${predicted.padEnd(11)} ${failure.title}`);
    });
    judgments.sort((a, b) => a.mutantId.localeCompare(b.mutantId) || a.test.localeCompare(b.test));
    configResults.push({
      id: config.id,
      model: config.model,
      context: config.context,
      aiMode: config.aiMode,
      effort: "medium", // the effort level used by triage.ts for every call
      costUsd, // API list price of these calls (what it would cost on the API; $0 billed on a subscription)
      phaseSec: Math.round((Date.now() - phaseStart) / 1000), // wall-clock time for this configuration (4 calls at a time)
      judgments,
    });
  }
}

// ---------- Phase 3: grade and save ----------
const output = {
  settings: { level: LEVEL, cases: CASES, seed: SEED, candidates: candidates.length, skipAi: SKIP_AI },
  createdAt: new Date().toISOString(),
  durationSec: Math.round((Date.now() - started) / 1000),
  mutation: computeMutationMetrics(mutantResults),
  mutants: mutantResults.map(({ sources, failures, ...m }) => ({ ...m, failingTests: failures.map((f) => f.title) })),
  configs: configResults.map((c) => ({ ...c, metrics: computeAiMetrics(c.judgments) })),
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(`${OUT_DIR}/${LEVEL}.json`, JSON.stringify(output, null, 2) + "\n");
fs.rmSync(".bench", { recursive: true, force: true });

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mu = output.mutation;
console.log(`\n═══ Results (${LEVEL})`);
console.log(`Mutation score (app mutants caught by the tests): ${mu.mutationScore.killed}/${mu.mutationScore.total} = ${pct(mu.mutationScore.rate)}`);
console.log(`Test mutants that made a test fail:               ${mu.testMutantsDetected.killed}/${mu.testMutantsDetected.total}`);
for (const c of output.configs) {
  const a = c.metrics.accuracy;
  const cost = c.aiMode === "api" ? `$${c.costUsd.toFixed(2)}` : `$0 API (equiv. $${c.costUsd.toFixed(2)})`;
  console.log(`${c.id.padEnd(16)} accuracy ${`${a.correct}/${a.total}`.padEnd(7)} ${pct(a.rate).padStart(6)}  (95%: ${pct(a.low)}–${pct(a.high)})  avg ${c.metrics.avgSeconds.toFixed(1)}s  ${cost}`);
}
console.log(`Took ${Math.round((Date.now() - started) / 60000)} min. Saved to ${OUT_DIR}/${LEVEL}.json`);

process.argv.push("--level", LEVEL); // tell the report which file to read
await import("./report.js");
