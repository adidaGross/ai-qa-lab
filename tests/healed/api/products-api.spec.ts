// 🤖 AUTO-HEALED BY AI on 2026-11-20
// Original file: tests/api/products-api.spec.ts
// Healed tests: "GET product by id returns that product"
// Review these fixes, then copy them into the original file. Do not edit by hand.

import { test, expect } from "@playwright/test";

// API tests don't open a browser page. The "request" helper sends HTTP calls directly.

test("GET product by id returns that product", async ({ request }) => {
  const response = await request.get("/api/products/2");
  expect(response.status()).toBe(200);
  const product = await response.json();
  expect(product.name).toBe("Desk Lamp");
});

