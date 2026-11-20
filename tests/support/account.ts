// Helpers that let automation get through 2FA and passkeys, instead of failing at them.
//
//   authenticatorCode()   the 6-digit 2FA code, computed from the account's 2FA secret,
//                         exactly like an authenticator app does. No phone, no fixed codes.
//   addVirtualPasskeyDevice()  Chromium's built-in virtual authenticator: a fake passkey
//                         device that answers WebAuthn requests automatically.
//   test.signedInPage     a page that is ALREADY signed in. The 2FA sign-in runs once per
//                         worker through the API, and the saved session (cookies) is reused.
//
// Only for TEST accounts you control: the 2FA secret belongs in your CI secrets, never in a real user's account.

import crypto from "node:crypto";
import { test as base, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";

export { expect };

export const ACCOUNT = {
  username: "dana",
  password: "Str0ng-Pass!",
  totpSecret: process.env.TEST_TOTP_SECRET ?? "JBSWY3DPEHPK3PXP", // demo secret; real projects read it from a CI secret
};

// ---------- 2FA: the authenticator app, in code ----------
function base32Decode(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of text.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

/** The 2FA code an authenticator app would show at time `at` (default: now). */
export function authenticatorCode(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hash = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hash[hash.length - 1] & 0xf;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Signs in through the page: password, then the 2FA code. */
export async function signInWith2FA(page: Page, code = authenticatorCode(ACCOUNT.totpSecret)) {
  await page.getByTestId("account-username").fill(ACCOUNT.username);
  await page.getByTestId("account-password").fill(ACCOUNT.password);
  await page.getByTestId("account-login-button").click();
  await page.getByTestId("account-code").fill(code);
  await page.getByTestId("account-verify-button").click();
}

/** Signs in through the API only (fast, no browser), for setting up a session. */
export async function signInWithApi(request: APIRequestContext) {
  const login = await (await request.post("/api/account/login", { data: { username: ACCOUNT.username, password: ACCOUNT.password } })).json();
  const verify = await request.post("/api/account/verify-code", { data: { ticket: login.ticket, code: authenticatorCode(ACCOUNT.totpSecret) } });
  expect(verify.ok(), "2FA sign-in through the API").toBe(true);
}

// ---------- Passkeys: a virtual device ----------
/**
 * Adds a virtual passkey device to the page (Chromium only, through the DevTools protocol).
 * It answers every passkey request at once, as if the user touched the fingerprint sensor.
 */
export async function addVirtualPasskeyDevice(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal", // a built-in sensor, like Touch ID or Windows Hello
      hasResidentKey: true, // can store passkeys
      hasUserVerification: true,
      isUserVerified: true, // the "fingerprint" always matches
      automaticPresenceSimulation: true, // no click needed on the device
    },
  });
  return {
    /** Passkeys stored on the device */
    credentials: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials,
    /** Puts a passkey on the device that the site has never seen */
    addUnknownPasskey: async () => {
      const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
      await cdp.send("WebAuthn.addCredential", {
        authenticatorId,
        credential: {
          credentialId: crypto.randomBytes(16).toString("base64"),
          isResidentCredential: true,
          rpId: "localhost",
          privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
          userHandle: Buffer.from("stranger").toString("base64"),
          signCount: 0,
        },
      });
    },
  };
}

// ---------- Reusing a signed-in session ----------
// Signing in with 2FA in every test is slow, and the same code may not be accepted twice.
// So each worker signs in ONCE through the API and saves the session; tests reuse it.
export const test = base.extend<{ signedInPage: Page }, { savedSession: Awaited<ReturnType<BrowserContext["storageState"]>> }>({
  savedSession: [
    async ({ playwright }, use, workerInfo) => {
      const request = await playwright.request.newContext({ baseURL: workerInfo.project.use.baseURL });
      await signInWithApi(request);
      await use(await request.storageState());
      await request.dispose();
    },
    { scope: "worker" },
  ],
  signedInPage: async ({ browser, savedSession }, use, testInfo) => {
    const context = await browser.newContext({ storageState: savedSession, baseURL: testInfo.project.use.baseURL });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});
