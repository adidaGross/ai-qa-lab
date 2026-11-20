import { test, expect } from "@playwright/test";

// API tests don't open a browser page. The "request" helper sends HTTP calls directly.

test("GET /api/products returns 5 products", async ({ request }) => {
  const response = await request.get("/api/products");
  expect(response.status()).toBe(200);
  const products = await response.json();
  expect(products).toHaveLength(5);
});

test("GET product by id returns that product", async ({ request }) => {
  const response = await request.get("/api/product/2");
  expect(response.status()).toBe(200);
  const product = await response.json();
  expect(product.name).toBe("Desk Lamp");
});

test("GET missing product returns 404", async ({ request }) => {
  const response = await request.get("/api/products/999");
  expect(response.status()).toBe(404);
});
