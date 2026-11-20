// Builds the portfolio website into dist/ (deployed to GitHub Pages by .github/workflows/pages.yml).
//   - fills the page templates (portfolio/*.html); {{README}} becomes README.md as HTML if a page uses it
//   - copies the page files, the recorded run, and the README screenshots
// Run it with:  npm run portfolio:build   then preview with  npm run portfolio:preview

import fs from "node:fs";
import { marked } from "marked";

const REPO_URL = "https://github.com/adidaGross/ai-qa-lab";
const OUT = "dist";

if (!fs.existsSync("portfolio/recording/run.json")) {
  throw new Error('No recorded run. Run "npm run verify-fixes" and "npm run recording:save" first.');
}

// 1. README -> HTML. The title, badge and first screenshot (everything before the first "---")
//    are skipped because the website's hero section already covers them.
const readme = fs.readFileSync("README.md", "utf8");
const body = readme.split(/^---$/m).slice(1).join("---");
let readmeHtml = await marked.parse(body);

// 2. Links to project files (e.g. "ai/analyze.ts") point to GitHub, since the site only has the page.
readmeHtml = readmeHtml.replace(/href="(?!https?:|#|mailto:)([^"]+)"/g, (_m, link) => {
  const clean = link.replace(/^\.\//, "");
  const kind = fs.existsSync(clean) && fs.statSync(clean).isDirectory() ? "tree" : "blob"; // folders vs files
  return `href="${REPO_URL}/${kind}/main/${clean}" target="_blank" rel="noopener"`;
});

// 3+4. Fill every page template (portfolio/*.html) and copy the styles and scripts to dist/
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const file of fs.readdirSync("portfolio")) {
  if (file.endsWith(".html")) {
    const page = fs
      .readFileSync(`portfolio/${file}`, "utf8")
      .replace("{{README}}", () => readmeHtml)
      .replaceAll("{{REPO_URL}}", REPO_URL);
    fs.writeFileSync(`${OUT}/${file}`, page);
  } else if (/\.(css|js)$/.test(file)) {
    fs.copyFileSync(`portfolio/${file}`, `${OUT}/${file}`);
  }
}
fs.cpSync("portfolio/recording", `${OUT}/recording`, { recursive: true });
// The latest mutation benchmarks: basic.json / hard.json and their reports
// (the section stays hidden on the site if there are none)
if (fs.existsSync("benchmark/results")) fs.cpSync("benchmark/results", `${OUT}/benchmark`, { recursive: true });
fs.cpSync("docs/images", `${OUT}/docs/images`, { recursive: true });
fs.writeFileSync(`${OUT}/.nojekyll`, ""); // tell GitHub Pages to serve files as they are

console.log(`🌐 Portfolio built in ${OUT}/`);
