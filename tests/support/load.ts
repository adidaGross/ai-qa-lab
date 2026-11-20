// A small load generator for the load tests: many "virtual users" send requests at the
// same time for a few seconds, and we measure response times and errors.
//
// The load tests start their OWN copy of the shop on a separate port, so the heavy traffic
// never slows down the other tests running at the same time.

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export type LoadStats = {
  requests: number;
  errors: number;
  errorRate: number; // 0..1
  perSecond: number;
  p50: number; // ms: half of the requests were faster than this
  p95: number; // ms: 95% of the requests were faster than this
  max: number; // ms
};

/** Starts a private copy of the shop on `port`. Call stop() when done. */
export async function startServer(port: number): Promise<{ url: string; stop: () => void }> {
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", path.resolve("src/server.ts")], {
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/api/products`)).ok) return { url, stop: () => child.kill() };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`The test server on port ${port} did not start`);
}

/**
 * Runs `users` virtual users for `seconds`. Each user calls `request()` in a loop,
 * waiting for each answer before sending the next (like a real user, only faster).
 */
export async function runLoad(users: number, seconds: number, request: () => Promise<Response>): Promise<LoadStats> {
  const times: number[] = [];
  let errors = 0;
  const end = Date.now() + seconds * 1000;
  const user = async () => {
    while (Date.now() < end) {
      const start = performance.now();
      try {
        const res = await request();
        await res.arrayBuffer(); // read the whole answer
        if (!res.ok) errors++;
      } catch {
        errors++;
      }
      times.push(performance.now() - start);
    }
  };
  await Promise.all(Array.from({ length: users }, user));

  times.sort((a, b) => a - b);
  const at = (q: number) => Math.round(times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0);
  return {
    requests: times.length,
    errors,
    errorRate: times.length ? errors / times.length : 1,
    perSecond: Math.round(times.length / seconds),
    p50: at(0.5),
    p95: at(0.95),
    max: Math.round(times.at(-1) ?? 0),
  };
}

/** One readable line for reports and error messages */
export const describe = (s: LoadStats) =>
  `${s.requests} requests (${s.perSecond}/s), ${s.errors} errors, p50 ${s.p50} ms, p95 ${s.p95} ms, max ${s.max} ms`;
