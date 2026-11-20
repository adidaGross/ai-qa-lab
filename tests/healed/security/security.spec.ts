// 🤖 AUTO-HEALED BY AI on 2026-11-20
// Original file: tests/security/security.spec.ts
// Healed tests: "API responses disable content-type sniffing"
// Review these fixes, then copy them into the original file. Do not edit by hand.

// Security checks: response headers, cookies, access control, brute force, and information leaks.
// (The XSS check lives in tests/ui/products.spec.ts, the sign-in checks in tests/auth.)
import { test, expect, ACCOUNT, signInWithApi } from "../../support/account.js";

test("API responses disable content-type sniffing", async ({ request }) => {
  const res = await request.get("/api/products");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

