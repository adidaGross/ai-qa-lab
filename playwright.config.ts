// Playwright settings: where tests live, which browser, and what reports to produce.
import { defineConfig, devices } from "@playwright/test";

// "npm run test:healed" runs only the healed tests. Their results go to their own file,
// so they never overwrite the main run's report.
const healedRun = process.argv.includes("--project=healed");

export default defineConfig({
  testDir: "./tests",
  timeout: 10_000, // a single test fails if it takes longer than 10 seconds
  expect: { timeout: 2_000 }, // how long expect() keeps retrying before failing
  retries: 0, // no automatic retries: we want to SEE every failure

  // Reports:
  //  - "list": readable output in the terminal
  //  - "json": machine-readable results; the AI will read this file in Phase 3
  //  - "html": a nice report you can open in the browser
  reporter: healedRun
    ? [["list"], ["json", { outputFile: "reports/healed-results.json" }]]
    : [
        ["list"],
        ["json", { outputFile: "reports/results.json" }],
        ["html", { outputFolder: "reports/html", open: "never" }],
      ],

  use: {
    baseURL: "http://localhost:3000", // so tests can write page.goto("/")
    screenshot: "only-on-failure",
    trace: "retain-on-failure", // a step-by-step recording of failed tests
  },

  // Start the shop automatically before the tests (or reuse it if already running)
  webServer: {
    command: "npm start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },

  // Two groups ("projects") of tests:
  //  - "main":   the normal test suite (everything except tests/healed)
  //  - "healed": the AI-fixed copies of broken tests, run separately to prove the fixes work
  projects: [
    { name: "main", testIgnore: "**/healed/**", use: { ...devices["Desktop Chrome"] } },
    { name: "healed", testDir: "./tests/healed", use: { ...devices["Desktop Chrome"] } },
  ],
});
