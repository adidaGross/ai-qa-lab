// "My account": the kind of sign-in that often breaks test automation.
//   1. Password + 2FA code (TOTP): the 6-digit code an authenticator app shows every 30 seconds
//   2. Passkeys (WebAuthn): sign in with the device instead of a password
//   3. Sessions: a cookie that keeps you signed in
// The tests automate all three: they compute the 2FA code themselves and use Chromium's
// virtual authenticator as the passkey device (see tests/support/account.ts).

import crypto from "node:crypto";
import { promisify } from "node:util";
import type { Express, Request, Response } from "express";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";

// A TEST account. The 2FA secret is what an authenticator app saves when you scan the QR code.
const account = { username: "dana", password: "Str0ng-Pass!", totpSecret: "JBSWY3DPEHPK3PXP" };

// Passwords are stored only as a slow hash (scrypt), so a stolen database doesn't reveal them.
// Hashing is deliberately expensive: tens of milliseconds of CPU per sign-in.
const SALT = crypto.randomBytes(16);
const passwordHash = crypto.scryptSync(account.password, SALT, 64);
const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

// After this many wrong 2FA codes the sign-in is cancelled (a 6-digit code must not be guessable)
const MAX_CODE_ATTEMPTS = 50;

// ---------- 2FA codes (TOTP, RFC 6238) ----------
function base32Decode(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of text.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

// The code for one 30-second window
function totpCode(secret: string, window: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(window));
  const hash = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hash[hash.length - 1] & 0xf;
  const number = (hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}

function isValidCode(code: string): boolean {
  const now = Math.floor(Date.now() / 1000 / 30);
  // Accept the current window and the ones around it (phone clocks are never perfectly in sync)
  for (let step = -20; step <= 1; step++) {
    if (totpCode(account.totpSecret, now + step) === code) return true;
  }
  return false;
}

// ---------- sessions ----------
const sessions = new Map<string, string>(); // session id -> username
const waitingForCode = new Map<string, string>(); // password was right, 2FA code still needed: ticket -> username
const wrongCodes = new Map<string, number>(); // ticket -> wrong 2FA codes so far

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function startSession(res: Response, username: string) {
  const id = crypto.randomUUID();
  sessions.set(id, username);
  res.cookie("sid", id, { httpOnly: true, sameSite: "strict", path: "/" });
}

const currentUser = (req: Request) => sessions.get(readCookie(req, "sid") ?? "");

// ---------- passkeys ----------
const RP_ID = "localhost"; // the site a passkey belongs to
const passkeys: { username: string; credential: WebAuthnCredential }[] = [];
const challenges = new Map<string, string>(); // challenge id -> the challenge the browser must sign
const originOf = (req: Request) => `${req.protocol}://${req.get("host")}`;

export function addAccountRoutes(app: Express) {
  // Step 1 of 2: password
  app.post("/api/account/login", async (req: Request, res: Response) => {
    const { username, password } = req.body ?? {};
    const attempt = crypto.scryptSync(String(password ?? ""), SALT, 64);
    if (username !== account.username || !crypto.timingSafeEqual(attempt, passwordHash)) {
      res.status(401).json({ ok: false, message: "Invalid username or password" });
      return;
    }
    const ticket = crypto.randomUUID();
    waitingForCode.set(ticket, username);
    res.json({ ok: true, needsCode: true, ticket, message: "Enter the 6-digit code from your authenticator app" });
  });

  // Step 2 of 2: the 2FA code
  app.post("/api/account/verify-code", (req: Request, res: Response) => {
    const { ticket, code } = req.body ?? {};
    const username = waitingForCode.get(ticket);
    if (!username) {
      res.status(401).json({ ok: false, message: "Sign in with your password first" });
      return;
    }
    if ((wrongCodes.get(ticket) ?? 0) >= MAX_CODE_ATTEMPTS) {
      waitingForCode.delete(ticket);
      res.status(429).json({ ok: false, message: "Too many wrong codes. Sign in again." });
      return;
    }
    if (!isValidCode(String(code ?? ""))) {
      wrongCodes.set(ticket, (wrongCodes.get(ticket) ?? 0) + 1);
      res.status(401).json({ ok: false, message: "Invalid code" });
      return;
    }
    waitingForCode.delete(ticket);
    wrongCodes.delete(ticket);
    startSession(res, username);
    res.json({ ok: true, message: `Signed in as ${username}` });
  });

  app.get("/api/account/me", (req: Request, res: Response) => {
    const username = currentUser(req);
    if (!username) {
      res.status(401).json({ signedIn: false });
      return;
    }
    res.json({ signedIn: true, username, passkeys: passkeys.filter((p) => p.username === username).length });
  });

  app.post("/api/account/logout", (req: Request, res: Response) => {
    res.clearCookie("sid");
    res.json({ ok: true, message: "Signed out" });
  });

  // Create a passkey (you must be signed in)
  app.post("/api/passkey/register/options", async (req: Request, res: Response) => {
    const username = currentUser(req);
    if (!username) {
      res.status(401).json({ ok: false, message: "Sign in first" });
      return;
    }
    const options = await generateRegistrationOptions({
      rpName: "QA Shop",
      rpID: RP_ID,
      userName: username,
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      excludeCredentials: passkeys.filter((p) => p.username === username).map((p) => ({ id: p.credential.id })),
    });
    const challengeId = crypto.randomUUID();
    challenges.set(challengeId, options.challenge);
    res.json({ challengeId, options });
  });

  app.post("/api/passkey/register/verify", async (req: Request, res: Response) => {
    const username = currentUser(req);
    const { challengeId, response } = req.body ?? {};
    const expectedChallenge = challenges.get(challengeId);
    challenges.delete(challengeId); // a challenge can be used only once
    if (!username || !expectedChallenge) {
      res.status(400).json({ ok: false, message: "Passkey setup expired, try again" });
      return;
    }
    try {
      const result = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: originOf(req), expectedRPID: RP_ID });
      if (!result.verified) throw new Error("not verified");
      passkeys.push({ username, credential: { ...result.registrationInfo.credential, transports: response.response?.transports } });
      res.json({ ok: true, message: "Passkey created" });
    } catch {
      res.status(400).json({ ok: false, message: "Could not create the passkey" });
    }
  });

  // Sign in with a passkey (no username or password needed)
  app.post("/api/passkey/login/options", async (_req: Request, res: Response) => {
    const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: "preferred" });
    const challengeId = crypto.randomUUID();
    challenges.set(challengeId, options.challenge);
    res.json({ challengeId, options });
  });

  app.post("/api/passkey/login/verify", async (req: Request, res: Response) => {
    const { challengeId, response } = req.body ?? {};
    const expectedChallenge = challenges.get(challengeId);
    challenges.delete(challengeId);
    const passkey = passkeys.find((p) => p.credential.id === response?.id);
    if (!expectedChallenge || !passkey) {
      res.status(401).json({ ok: false, message: "This passkey is not registered" });
      return;
    }
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: originOf(req),
        expectedRPID: RP_ID,
        credential: passkey.credential,
      });
      if (!result.verified) throw new Error("not verified");
      passkey.credential.counter = result.authenticationInfo.newCounter;
      startSession(res, passkey.username);
      res.json({ ok: true, message: `Signed in as ${passkey.username} with a passkey` });
    } catch {
      res.status(401).json({ ok: false, message: "Passkey sign-in failed" });
    }
  });
}
