import { test, expect, ACCOUNT, authenticatorCode, signInWith2FA, signInWithApi, addVirtualPasskeyDevice } from "../support/account.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("2FA sign-in works with a code from the authenticator app", async ({ page }) => {
  await signInWith2FA(page);
  await expect(page.getByTestId("account-status")).toHaveText("Signed in as dana");
});

test("a wrong 2FA code is rejected", async ({ page }) => {
  const code = authenticatorCode(ACCOUNT.totpSecret);
  const wrong = code.slice(0, 5) + String((Number(code[5]) + 5) % 10); // change the last digit
  await signInWith2FA(page, wrong);
  await expect(page.getByTestId("account-message")).toHaveText("Invalid code");
  await expect(page.getByTestId("account-status")).toHaveText("Not signed in");
});

test("an expired 2FA code is rejected", async ({ page }) => {
  const fiveMinutesAgo = authenticatorCode(ACCOUNT.totpSecret, Date.now() - 5 * 60 * 1000);
  await signInWith2FA(page, fiveMinutesAgo);
  await expect(page.getByTestId("account-message")).toHaveText("Invalid code");
});

test("account page shows the signed-in user after 2FA", async ({ page }) => {
  await page.getByTestId("account-username").fill("dana");
  await page.getByTestId("account-password").fill("Str0ng-Pass!");
  await page.getByTestId("account-login-button").click();
  await page.getByTestId("account-code").fill("492039");
  await page.getByTestId("account-verify-button").click();
  await expect(page.getByTestId("account-status")).toHaveText("Signed in as dana");
});

test("passkey sign-in works after creating a passkey", async ({ page }) => {
  const device = await addVirtualPasskeyDevice(page);
  await signInWith2FA(page);
  await page.getByTestId("passkey-create-button").click();
  await expect(page.getByTestId("account-message")).toHaveText("Passkey created");
  expect(await device.credentials()).toHaveLength(1);

  await page.getByTestId("account-logout-button").click();
  await expect(page.getByTestId("account-status")).toHaveText("Not signed in");
  await page.getByTestId("passkey-login-button").click();
  await expect(page.getByTestId("account-status")).toHaveText("Signed in as dana");
  await expect(page.getByTestId("account-message")).toHaveText("Signed in as dana with a passkey");
});

test("a passkey the site does not know cannot sign in", async ({ page }) => {
  const device = await addVirtualPasskeyDevice(page);
  await device.addUnknownPasskey();
  await page.getByTestId("passkey-login-button").click();
  await expect(page.getByTestId("account-message")).toHaveText("This passkey is not registered");
  await expect(page.getByTestId("account-status")).toHaveText("Not signed in");
});

test("a saved session opens the account without signing in again", async ({ signedInPage }) => {
  await signedInPage.goto("/");
  await expect(signedInPage.getByTestId("account-status")).toHaveText("Signed in as dana");
});

test("signing out ends the session on the server", async ({ playwright, baseURL }) => {
  const browserSession = await playwright.request.newContext({ baseURL });
  await signInWithApi(browserSession);
  const cookiesBeforeLogout = await browserSession.storageState();
  await browserSession.post("/api/account/logout");

  // Someone who copied the session cookie before the logout must not get in
  const copied = await playwright.request.newContext({ baseURL, storageState: cookiesBeforeLogout });
  const me = await copied.get("/api/account/me");
  expect(me.status()).toBe(401);
});
