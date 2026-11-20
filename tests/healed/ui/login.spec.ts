// 🤖 AUTO-HEALED BY AI on 2026-11-20
// Original file: tests/ui/login.spec.ts
// Healed tests: "login succeeds with correct credentials"
// Review these fixes, then copy them into the original file. Do not edit by hand.

import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("login succeeds with correct credentials", async ({ page }) => {
  await page.getByTestId("username").fill("admin");
  await page.getByTestId("password").fill("Secret123");
  await page.getByTestId("login-button").click();
  await expect(page.getByTestId("login-message")).toHaveText("Welcome, admin!");
});

