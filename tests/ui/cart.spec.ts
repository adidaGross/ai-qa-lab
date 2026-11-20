import { test, expect, Page } from "@playwright/test";

// A small helper so each test can say addToCart(page, "Coffee Mug") in one line.
async function addToCart(page: Page, productName: string) {
  const product = page.getByTestId("product-item").filter({ hasText: productName });
  await product.getByTestId("add-to-cart").click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("adding a product shows it in the cart", async ({ page }) => {
  await addToCart(page, "Coffee Mug");
  await expect(page.getByTestId("cart-item-name")).toHaveText(["Coffee Mug"]);
  await expect(page.getByTestId("cart-total")).toHaveText("12.50");
});

test("cart total multiplies price by quantity", async ({ page }) => {
  await addToCart(page, "Coffee Mug");
  await addToCart(page, "Coffee Mug");
  await expect(page.getByTestId("cart-item-qty")).toHaveText("2");
  await expect(page.getByTestId("cart-total")).toHaveText("25.00");
});

test("discount code SAVE10 gives 10% off", async ({ page }) => {
  await addToCart(page, "Desk Lamp"); // 39.90
  await page.getByTestId("discount-input").fill("SAVE10");
  await page.getByTestId("apply-discount").click();
  await expect(page.getByTestId("cart-total")).toHaveText("35.91"); // 39.90 * 0.9
});

test("remove deletes the clicked item", async ({ page }) => {
  await addToCart(page, "Coffee Mug");
  await addToCart(page, "Desk Lamp");
  const mugRow = page.getByTestId("cart-item").filter({ hasText: "Coffee Mug" });
  await mugRow.getByTestId("remove-item").click();
  await expect(page.getByTestId("cart-item-name")).toHaveText(["Desk Lamp"]);
});

test("quantity cannot go below 1", async ({ page }) => {
  await addToCart(page, "Coffee Mug");
  await page.getByTestId("qty-minus").click();
  await page.getByTestId("qty-minus").click();
  await expect(page.getByTestId("cart-item-qty")).toHaveText("1");
});
