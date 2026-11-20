import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
const [file, out] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 520 }, deviceScaleFactor: 2 });
await p.goto(pathToFileURL(file).href); await p.screenshot({ path: out, fullPage: true }); await b.close();
