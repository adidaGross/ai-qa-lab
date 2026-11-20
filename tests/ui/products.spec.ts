import { test, expect } from "@playwright/test";

// beforeEach runs before EVERY test in this file: open the shop's home page.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("shows all 5 products", async ({ page }) => {
  await expect(page.getByTestId("product-item")).toHaveCount(5);
});

test("shows product names in the list", async ({ page }) => {
  await expect(page.getByTestId("product-title").first()).toHaveText("Coffee Mug");
});

test("shows the correct price for Notebook", async ({ page }) => {
  const notebook = page.getByTestId("product-item").filter({ hasText: "Notebook" });
  await expect(notebook.getByTestId("product-price")).toHaveText("$4.57");
});

test("search finds products regardless of capitalization", async ({ page }) => {
  await page.getByTestId("search").fill("mug");
  await expect(page.getByTestId("product-name")).toHaveText(["Coffee Mug"]);
});

test("search shows user input as plain text", async ({ page }) => {
  const input = '<img src=x onerror="window.hacked=true">';
  await page.getByTestId("search").fill(input);
  await expect(page.getByTestId("search-message")).toContainText(input);
});
