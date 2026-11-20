// 🤖 AUTO-HEALED BY AI on 2026-11-20
// Original file: tests/ui/products.spec.ts
// Healed tests: "shows product names in the list", "shows the correct price for Notebook"
// Review these fixes, then copy them into the original file. Do not edit by hand.

import { test, expect } from "@playwright/test";

// beforeEach runs before EVERY test in this file: open the shop's home page.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("shows product names in the list", async ({ page }) => {
  await expect(page.getByTestId("product-name").first()).toHaveText("Coffee Mug");
});

test("shows the correct price for Notebook", async ({ page }) => {
  const notebook = page.getByTestId("product-item").filter({ hasText: "Notebook" });
  await expect(notebook.getByTestId("product-price")).toHaveText("$4.75");
});

