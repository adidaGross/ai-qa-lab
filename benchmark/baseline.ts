// The CLEAN baseline for the mutation benchmark: a copy of the project where all
// 15 planted bugs are fixed and all 8 broken tests are repaired, so every test passes.
// (The load tests are left out: timing tests would be unreliable with several mutants running at once.)
// Each mutant then starts from this clean copy and adds exactly ONE change.

import fs from "node:fs";
import path from "node:path";

type Fix = { file: string; find: string; replace: string; why: string };

export const FIXES: Fix[] = [
  // ----- the 15 planted app bugs -----
  { file: "site/app.js", why: "BUG-001", find: "sum + item.price, 0", replace: "sum + item.price * item.quantity, 0" },
  { file: "site/app.js", why: "BUG-002", find: "discountRate = 0.01", replace: "discountRate = 0.1" },
  { file: "site/app.js", why: "BUG-003", find: "p.name.includes(term)", replace: "p.name.toLowerCase().includes(term.toLowerCase())" },
  { file: "site/app.js", why: "BUG-004", find: "cart.splice(index + 1, 1);", replace: "cart.splice(index, 1);" },
  { file: "site/app.js", why: "BUG-005", find: "cart[index].quantity += delta;", replace: "cart[index].quantity = Math.max(1, cart[index].quantity + delta);" },
  { file: "site/app.js", why: "BUG-006", find: 'return email.includes(".");', replace: "return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);" },
  { file: "site/app.js", why: "BUG-009", find: '$("search-message").innerHTML =', replace: '$("search-message").textContent =' },
  {
    file: "src/server.ts",
    why: "BUG-007",
    find: "  res.status(200).json(product ?? {});",
    replace: '  if (!product) {\n    res.status(404).json({ error: "Product not found" });\n    return;\n  }\n  res.json(product);',
  },
  { file: "src/server.ts", why: "BUG-008", find: "u.username === username)", replace: "u.username === username && u.password === password)" },
  {
    file: "site/index.html",
    why: "BUG-010",
    find: '      <input id="password"',
    replace: '      <label for="password">Password</label>\n      <input id="password"',
  },

  { file: "src/account.ts", why: "BUG-011", find: "step = -20;", replace: "step = -1;" },
  {
    file: "src/account.ts",
    why: "BUG-012",
    find: '  res.clearCookie("sid");',
    replace: '  sessions.delete(readCookie(req, "sid") ?? "");\n  res.clearCookie("sid");',
  },

  { file: "src/account.ts", why: "BUG-013", find: "MAX_CODE_ATTEMPTS = 50;", replace: "MAX_CODE_ATTEMPTS = 5;" },
  { file: "src/server.ts", why: "BUG-014", find: "{ error: err.message, stack: err.stack }", replace: "{ error: err.message }" },
  {
    file: "src/account.ts",
    why: "BUG-015",
    find: 'crypto.scryptSync(String(password ?? ""), SALT, 64);',
    replace: 'await scrypt(String(password ?? ""), SALT, 64);',
  },

  // ----- the 8 deliberately broken tests -----
  { file: "tests/ui/products.spec.ts", why: "TEST-001", find: 'getByTestId("product-title")', replace: 'getByTestId("product-name")' },
  { file: "tests/ui/products.spec.ts", why: "TEST-002", find: 'toHaveText("$4.57")', replace: 'toHaveText("$4.75")' },
  { file: "tests/ui/checkout.spec.ts", why: "TEST-003", find: 'fill("customer@example")', replace: 'fill("customer@example.com")' },
  {
    file: "tests/ui/checkout.spec.ts",
    why: "TEST-004",
    find: '  await page.getByTestId("email").fill("dana@example.com");\n  await page.getByTestId("checkout-button").click();\n  await addToCart(page, "Headphones");',
    replace: '  await addToCart(page, "Headphones");\n  await page.getByTestId("email").fill("dana@example.com");\n  await page.getByTestId("checkout-button").click();',
  },
  {
    file: "tests/ui/login.spec.ts",
    why: "TEST-005",
    find: '  const message = await page.getByTestId("login-message").textContent();\n  expect(message).toBe("Welcome, admin!");',
    replace: '  await expect(page.getByTestId("login-message")).toHaveText("Welcome, admin!");',
  },
  { file: "tests/auth/account.spec.ts", why: "TEST-007", find: 'fill("492039")', replace: "fill(authenticatorCode(ACCOUNT.totpSecret))" },
  { file: "tests/security/security.spec.ts", why: "TEST-008", find: 'headers()["X-Content-Type-Options"]', replace: 'headers()["x-content-type-options"]' },
  { file: "tests/api/products-api.spec.ts", why: "TEST-006", find: 'request.get("/api/product/2")', replace: 'request.get("/api/products/2")' },
];

// The files the benchmark copies (healed tests are not part of the suite).
export const APP_FILES = ["site/index.html", "site/app.js", "site/styles.css", "src/server.ts", "src/account.ts"];
export function listTestFiles(): string[] {
  return fs
    .readdirSync("tests", { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".spec.ts") && !f.startsWith("healed") && !f.startsWith("load"))
    .map((f) => path.join("tests", f));
}

// Shared test helpers (tests/support): copied so the tests can run, but never mutated (they hold no test() blocks)
export function listSupportFiles(): string[] {
  if (!fs.existsSync("tests/support")) return [];
  return fs.readdirSync("tests/support").filter((f) => f.endsWith(".ts")).map((f) => path.join("tests", "support", f));
}

// Returns the clean versions of all files: { "site/app.js": "...", ... }
export function cleanSources(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of [...APP_FILES, ...listTestFiles(), ...listSupportFiles()]) files[f] = fs.readFileSync(f, "utf8");

  for (const fix of FIXES) {
    const count = files[fix.file].split(fix.find).length - 1;
    if (count !== 1) {
      throw new Error(`Baseline fix ${fix.why} expected exactly 1 match in ${fix.file}, found ${count}. Was the file changed?`);
    }
    files[fix.file] = files[fix.file].replace(fix.find, () => fix.replace);
  }
  return files;
}

// Writes a set of sources into a working folder (e.g. .bench/lane-0)
export function writeWorkspace(dir: string, sources: Record<string, string>) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [file, content] of Object.entries(sources)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}
