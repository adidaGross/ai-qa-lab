import { test, expect, Page } from "@playwright/test";

async function addToCart(page: Page, productName: string) {
  const product = page.getByTestId("product-item").filter({ hasText: productName });
  await product.getByTestId("add-to-cart").click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("checkout with an empty cart shows an error", async ({ page }) => {
  await page.getByTestId("email").fill("dana@example.com");
  await page.getByTestId("checkout-button").click();
  await expect(page.getByTestId("checkout-message")).toHaveText("Your cart is empty");
});

test("checkout succeeds for a customer email", async ({ page }) => {
  await addToCart(page, "Notebook");
  await page.getByTestId("email").fill("customer@example");
  await page.getByTestId("checkout-button").click();
  await expect(page.getByTestId("checkout-message")).toContainText("Order placed!");
});

test("order confirmation shows the customer's email", async ({ page }) => {
  await page.getByTestId("email").fill("dana@example.com");
  await page.getByTestId("checkout-button").click();
  await addToCart(page, "Headphones");
  await expect(page.getByTestId("checkout-message")).toHaveText(
    "Order placed! Confirmation sent to dana@example.com"
  );
});

test("checkout rejects an email without @", async ({ page }) => {
  await addToCart(page, "Notebook");
  await page.getByTestId("email").fill("hello.world");
  await page.getByTestId("checkout-button").click();
  await expect(page.getByTestId("checkout-message")).toHaveText("Please enter a valid email");
});
