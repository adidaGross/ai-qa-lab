import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("login fails for an unknown user", async ({ page }) => {
  await page.getByTestId("username").fill("nobody");
  await page.getByTestId("password").fill("whatever");
  await page.getByTestId("login-button").click();
  await expect(page.getByTestId("login-message")).toHaveText("Invalid username or password");
});

test("login succeeds with correct credentials", async ({ page }) => {
  await page.getByTestId("username").fill("admin");
  await page.getByTestId("password").fill("Secret123");
  await page.getByTestId("login-button").click();
  const message = await page.getByTestId("login-message").textContent();
  expect(message).toBe("Welcome, admin!");
});

test("login fails with a wrong password", async ({ page }) => {
  await page.getByTestId("username").fill("admin");
  await page.getByTestId("password").fill("wrong-password");
  await page.getByTestId("login-button").click();
  await expect(page.getByTestId("login-message")).toHaveText("Invalid username or password");
});

test("password field has an accessible label", async ({ page }) => {
  // Check THIS field's name. getByLabel("Password") alone would also find other password fields on the page.
  await expect(page.getByTestId("password")).toHaveAccessibleName("Password");
});
