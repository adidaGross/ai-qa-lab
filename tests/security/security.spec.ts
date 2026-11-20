// Security checks: response headers, cookies, access control, brute force, and information leaks.
// (The XSS check lives in tests/ui/products.spec.ts, the sign-in checks in tests/auth.)
import { test, expect, ACCOUNT, signInWithApi } from "../support/account.js";

test("pages send basic browser security headers", async ({ request }) => {
  const res = await request.get("/");
  const headers = res.headers(); // Playwright gives header names in lowercase
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("no-referrer");
});

test("API responses disable content-type sniffing", async ({ request }) => {
  const res = await request.get("/api/products");
  expect(res.headers()["X-Content-Type-Options"]).toBe("nosniff");
});

test("the session cookie cannot be read by scripts or sent from other sites", async ({ request }) => {
  await signInWithApi(request);
  const cookie = (await request.storageState()).cookies.find((c) => c.name === "sid");
  expect(cookie, "session cookie after sign-in").toBeDefined();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe("Strict");
});

test("creating a passkey requires a signed-in user", async ({ request }) => {
  const res = await request.post("/api/passkey/register/options");
  expect(res.status()).toBe(401);
});

test("2FA code guessing is blocked after 5 wrong codes", async ({ request }) => {
  const login = await (await request.post("/api/account/login", { data: { username: ACCOUNT.username, password: ACCOUNT.password } })).json();
  for (let i = 0; i < 5; i++) {
    const wrong = await request.post("/api/account/verify-code", { data: { ticket: login.ticket, code: "000000" } });
    expect(wrong.status(), `wrong code #${i + 1}`).toBe(401);
  }
  const sixth = await request.post("/api/account/verify-code", { data: { ticket: login.ticket, code: "000000" } });
  expect(sixth.status(), "6th attempt must be refused").toBe(429);
});

test("error responses do not reveal server internals", async ({ request }) => {
  const res = await request.post("/api/login", {
    headers: { "Content-Type": "application/json" },
    data: Buffer.from('{"username": "admin", broken json'),
  });
  expect(res.status()).toBe(400);
  const body = await res.text();
  // Only report WHAT leaked: printing the body would copy the leaked paths into the test report
  expect(body.includes("node_modules"), "the error response contains server file paths (node_modules)").toBe(false);
  expect(/\bat \S+ \(/.test(body), "the error response contains a stack trace").toBe(false);
});
