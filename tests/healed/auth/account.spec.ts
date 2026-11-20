// 🤖 AUTO-HEALED BY AI on 2026-11-20
// Original file: tests/auth/account.spec.ts
// Healed tests: "account page shows the signed-in user after 2FA"
// Review these fixes, then copy them into the original file. Do not edit by hand.

import { test, expect, ACCOUNT, authenticatorCode, signInWith2FA, signInWithApi, addVirtualPasskeyDevice } from "../../support/account.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("account page shows the signed-in user after 2FA", async ({ page }) => {
  await page.getByTestId("account-username").fill(ACCOUNT.username);
  await page.getByTestId("account-password").fill(ACCOUNT.password);
  await page.getByTestId("account-login-button").click();
  await expect(page.getByTestId("account-code")).toBeVisible();
  await page.getByTestId("account-code").fill(authenticatorCode(ACCOUNT.totpSecret));
  await page.getByTestId("account-verify-button").click();
  await expect(page.getByTestId("account-status")).toHaveText("Signed in as dana");
});

