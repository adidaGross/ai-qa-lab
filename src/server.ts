// QA Shop - a small web server for our demo online shop.
// It does two jobs:
//   1. Serves the website files (HTML, CSS, JS) from the "site" folder.
//   2. Offers a small API (data endpoints) that the website calls.

import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addAccountRoutes } from "./account.js";

// A "type" describes the shape of our data. TypeScript checks we use it correctly.
type Product = {
  id: number;
  name: string;
  price: number;
  category: string;
};

const products: Product[] = [
  { id: 1, name: "Coffee Mug", price: 12.5, category: "Kitchen" },
  { id: 2, name: "Desk Lamp", price: 39.9, category: "Office" },
  { id: 3, name: "Notebook", price: 4.75, category: "Office" },
  { id: 4, name: "Water Bottle", price: 18.0, category: "Sports" },
  { id: 5, name: "Headphones", price: 79.99, category: "Electronics" },
];

const users = [{ username: "admin", password: "Secret123" }];

const app = express();
app.use(express.json(), slowLogin); // read JSON sent by the browser; login answers like a real server
app.use(securityHeaders);

// GET /api/products -> the whole product list
app.get("/api/products", (_req: Request, res: Response) => {
  res.json(products);
});

// GET /api/products/3 -> one product by its id
app.get("/api/products/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const product = products.find((p) => p.id === id);
  res.status(200).json(product ?? {});
});

// POST /api/login -> checks username and password
app.post("/api/login", (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  const user = users.find((u) => u.username === username);
  if (user) {
    res.json({ ok: true, message: `Welcome, ${username}!` });
  } else {
    res.status(401).json({ ok: false, message: "Invalid username or password" });
  }
});

// "My account": 2FA codes, passkeys and sessions (src/account.ts)
addAccountRoutes(app);

// Serve the website files
const here = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(here, "..", "site")));

// Also serve the test reports, e.g. http://localhost:3000/reports/ai-report.html
app.use("/reports", express.static(path.join(here, "..", "reports")));

// Errors (for example a request with broken JSON) are answered as JSON
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.status ?? 500).json({ error: err.message, stack: err.stack });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`QA Shop running at http://localhost:${PORT}`);
});

// A real login takes a moment (password hashing, database). Without this delay the local
// server answers so fast that a test with a missing wait (TEST-005) sometimes PASSES on fast
// machines: a flaky test. CI on macOS and Windows found exactly that. The delay makes it fail every time.
function slowLogin(req: Request, _res: Response, next: () => void) {
  if (req.path === "/api/login") setTimeout(next, 300);
  else next();
}

// Basic browser protections on every response
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({
    "X-Content-Type-Options": "nosniff", // don't guess file types (stops some XSS tricks)
    "X-Frame-Options": "DENY", // the shop may not be shown inside another site's frame (clickjacking)
    "Referrer-Policy": "no-referrer", // don't leak our URLs to other sites
  });
  next();
}

