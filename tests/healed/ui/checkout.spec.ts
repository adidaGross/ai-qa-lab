// 🤖 AUTO-HEALED BY AI on 2026-11-20
// Original file: tests/ui/checkout.spec.ts
// Healed tests: "checkout succeeds for a customer email", "order confirmation shows the customer's email"
// Review these fixes, then copy them into the original file. Do not edit by hand.

import { test, expect, Page } from "@playwright/test";

async function addToCart(page: Page, productName: string) {
  const product = page.getByTestId("product-item").filter({ hasText: productName });
  await product.getByTestId("add-to-cart").click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("checkout succeeds for a customer email", async ({ page }) => {
  await addToCart(page, "Notebook");
  await page.getByTestId("email").fill("customer@example.com");
  await page.getByTestId("checkout-button").click();
  await expect(page.getByTestId("checkout-message")).toContainText("Order placed!");
});

test("order confirmation shows the customer's email", async ({ page }) => {
  await addToCart(page, "Headphones");
  await page.getByTestId("email").fill("dana@example.com");
  await page.getByTestId("checkout-button").click();
  await expect(page.getByTestId("checkout-message")).toHaveText(
    "Order placed! Confirmation sent to dana@example.com"
  );
});

