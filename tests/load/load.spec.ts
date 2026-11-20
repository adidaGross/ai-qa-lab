// Load tests: does the shop stay fast when many people use it at once?
// Each test starts its own copy of the shop (tests/support/load.ts) and sends traffic for a few seconds.
import { test, expect } from "@playwright/test";
import { startServer, runLoad, describe } from "../support/load.js";

test.describe.configure({ timeout: 60_000 });

test("the product API handles 30 users at once", async ({}, testInfo) => {
  const server = await startServer(3400 + testInfo.workerIndex);
  try {
    const stats = await runLoad(30, 3, () => fetch(`${server.url}/api/products`));
    testInfo.annotations.push({ type: "load", description: describe(stats) });

    expect(stats.errors, `errors under load: ${describe(stats)}`).toBe(0);
    expect(stats.p95, `95% of product requests must answer within 300 ms: ${describe(stats)}`).toBeLessThan(300);
  } finally {
    server.stop();
  }
});

test("browsing stays fast while many users sign in", async ({}, testInfo) => {
  const server = await startServer(3500 + testInfo.workerIndex);
  try {
    const signIn = () =>
      fetch(`${server.url}/api/account/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "dana", password: "Str0ng-Pass!" }),
      });
    // 10 users keep signing in while 5 others browse the product list
    const [signIns, browsing] = await Promise.all([
      runLoad(10, 3, signIn),
      runLoad(5, 3, () => fetch(`${server.url}/api/products`)),
    ]);
    testInfo.annotations.push({ type: "load", description: `sign-ins: ${describe(signIns)} | browsing: ${describe(browsing)}` });

    expect(signIns.errors, `sign-in errors: ${describe(signIns)}`).toBe(0);
    expect(
      browsing.p95,
      `95% of product requests must answer within 150 ms during the sign-ins. Browsing: ${describe(browsing)}. Sign-ins: ${describe(signIns)}`
    ).toBeLessThan(150);
  } finally {
    server.stop();
  }
});
