// Takes the screenshots used in README.md (saved to docs/images/).
// Needs the shop running (npm start) and a generated report (npm run ai:report).
// Run it with:  npm run screenshots

import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = "http://localhost:3000";
fs.mkdirSync("docs/images", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, colorScheme: "light", deviceScaleFactor: 2 });

// 1. The report dashboard
await page.goto(`${BASE}/reports/ai-report.html`);
await page.screenshot({ path: "docs/images/report-dashboard.png" });

// 2. One app bug expanded (suggested code fix)
const bug = page.locator("section").nth(1).locator("details.ticket").nth(2);
await bug.evaluate((el: HTMLDetailsElement) => (el.open = true));
await bug.screenshot({ path: "docs/images/report-app-bug.png" });

// 3. One healed test expanded (before / after)
const healed = page.locator("section").nth(2).locator("details.ticket").first();
await healed.evaluate((el: HTMLDetailsElement) => (el.open = true));
await healed.screenshot({ path: "docs/images/report-healed-test.png" });

// 4. The buggy shop with two mugs in the cart (wrong total)
await page.goto(BASE);
const mug = page.getByTestId("product-item").filter({ hasText: "Coffee Mug" }).getByTestId("add-to-cart");
await mug.click();
await mug.click();
await page.screenshot({ path: "docs/images/shop.png" });

await browser.close();
console.log("Screenshots saved to docs/images/");
