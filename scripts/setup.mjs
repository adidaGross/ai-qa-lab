// One command from a fresh clone to a working project, on Linux, macOS or Windows:
//
//   npm run setup
//
//   1. checks the Node.js version
//   2. installs the npm packages
//   3. downloads the Playwright browser (Chromium)
//   4. runs the test suite once and checks it fails exactly as the answer key expects
//   5. checks how the AI will be reached (Claude Code subscription or API key), without calling it
//
// It times every step and prints how long the setup took.
// Plain JavaScript (not TypeScript) on purpose: it must run BEFORE the packages are installed.
//
// Options:  --ci          also install the browser's system libraries (Linux CI machines)
//           --skip-tests  skip step 4

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const CI = args.includes("--ci");
const SKIP_TESTS = args.includes("--skip-tests");
const isWindows = process.platform === "win32";
const timings = [];
const started = Date.now();

// npm tells us where its own CLI file is when it runs our script. Running that file with
// this Node avoids Windows' .cmd files and their quoting rules.
function npm(...npmArgs) {
  const cli = process.env.npm_execpath;
  if (cli && cli.endsWith(".js")) return [process.execPath, [cli, ...npmArgs], false];
  return ["npm", npmArgs, isWindows];
}
const playwright = (...pwArgs) => [process.execPath, [path.resolve("node_modules/@playwright/test/cli.js"), ...pwArgs], false];

function run([cmd, cmdArgs, shell], { quiet = false } = {}) {
  const result = spawnSync(cmd, cmdArgs, { stdio: quiet ? "ignore" : "inherit", shell });
  return result.status === 0;
}

function step(title, fn) {
  console.log(`\n── ${title}`);
  const t0 = Date.now();
  const ok = fn();
  const seconds = (Date.now() - t0) / 1000;
  timings.push({ step: title, seconds: Math.round(seconds * 10) / 10, ok });
  console.log(`${ok ? "✅" : "❌"} ${title} (${seconds.toFixed(1)}s)`);
  if (!ok) finish(1);
}

function finish(code) {
  const total = Math.round((Date.now() - started) / 100) / 10;
  const system = `${os.type()} ${os.release()} (${process.arch})`;
  console.log(`\n${"═".repeat(50)}`);
  for (const t of timings) console.log(`${t.ok ? "✅" : "❌"} ${t.step.padEnd(36)} ${String(t.seconds).padStart(6)}s`);
  console.log(`${"Total".padEnd(39)} ${String(total).padStart(6)}s   on ${system}, Node ${process.versions.node}`);
  console.log(code === 0 ? "\nReady. Next:  npm run verify-fixes   (the full AI flow)" : "\nSetup stopped at the failed step above.");

  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(
    "reports/setup-timing.json",
    JSON.stringify({ system, platform: process.platform, node: process.versions.node, totalSeconds: total, steps: timings }, null, 2)
  );
  // On GitHub Actions, also show the timings on the run's summary page
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = timings.map((t) => `| ${t.ok ? "✅" : "❌"} ${t.step} | ${t.seconds}s |`).join("\n");
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Setup time on ${process.env.RUNNER_OS ?? system}\n\n| Step | Time |\n|---|---|\n${rows}\n| **Total** | **${total}s** |\n\n`
    );
  }
  process.exit(code);
}

// 1. Node version
step("Check Node.js version (22 or newer)", () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) console.log(`   You have Node ${process.versions.node}. Install Node 22+ from https://nodejs.org`);
  return major >= 22;
});

// 2. Packages (exact versions from package-lock.json)
step("Install npm packages", () => run(npm("ci", "--no-audit", "--no-fund")));

// 3. Browser
step("Download the Playwright browser", () =>
  run(playwright("install", ...(CI && process.platform === "linux" ? ["--with-deps"] : []), "chromium"))
);

// 4. Smoke test: the suite must fail in exactly the planted ways
if (!SKIP_TESTS) {
  step("Run the 37 tests + check the baseline", () => {
    run(npm("test"), { quiet: true }); // failures are expected here
    return run(npm("run", "--silent", "test:baseline"));
  });
}

// 5. AI access (no AI call, so this step is free)
step("Check how the AI will be reached", () => {
  try {
    process.loadEnvFile(".env");
  } catch {}
  // The AI layer is the private ai-qa product package (an optional dependency)
  if (!fs.existsSync("node_modules/ai-qa/dist/index.js")) {
    console.log("   The ai-qa product package is not installed (it is private). The tests, baseline,");
    console.log("   healed tests and website work without it; the AI steps (npm run verify-fixes,");
    console.log("   the benchmark's AI phase) need access: https://github.com/adidaGross/ai-qa");
    return true;
  }
  const claude = spawnSync(isWindows ? "claude.exe" : "claude", ["--version"], { encoding: "utf8" });
  const hasClaude = claude.status === 0;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (hasClaude) console.log(`   Claude Code found (${claude.stdout.trim()}): AI runs on your Claude subscription (AI_MODE=max).`);
  if (hasKey) console.log("   API key found: AI_MODE=api will use the Claude API (billed per use).");
  if (!hasClaude && !hasKey) {
    console.log("   No AI access yet. Install Claude Code (https://claude.com/claude-code) or save an API key: npm run ai:set-key");
    console.log("   The tests, baseline and healed tests still work without AI.");
  }
  return true; // not having AI yet is not a setup failure
});

finish(0);
