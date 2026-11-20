// Playwright settings for ONE benchmark workspace (a mutated copy of the project).
// The runner sets BENCH_DIR (the copy) and BENCH_PORT (its own server port), so
// several mutants can be tested at the same time without getting in each other's way.

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const dir = path.resolve(process.env.BENCH_DIR ?? ".bench/lane-0");
const port = Number(process.env.BENCH_PORT ?? 3100);

export default defineConfig({
  testDir: path.join(dir, "tests"),
  timeout: 10_000,
  expect: { timeout: 2_000 },
  retries: 0,
  workers: 3,
  reporter: [["json", { outputFile: path.join(dir, "results.json") }]],
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `node --import tsx "${path.join(dir, "src/server.ts")}"`,
    url: `http://localhost:${port}`,
    env: { PORT: String(port) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: "bench", use: { ...devices["Desktop Chrome"] } }],
});
