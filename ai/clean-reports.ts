// Deletes old test and AI reports.
//
//   npm run clean:reports            -> keeps ONLY the last final report (reports/ai-report.html)
//   npm run clean:reports -- --all   -> deletes everything, including the last report
//                                       (used at the start of the full flow, so a new run
//                                        never mixes with leftovers from an older run)

import fs from "node:fs";
import path from "node:path";

const deleteAll = process.argv.includes("--all");
const KEEP = "reports/ai-report.html";

// Only these generated folders are ever touched. Source code, tests and .env are never deleted.
const GENERATED_FOLDERS = ["reports", "test-results"];

// Total size of a file or folder, so we can show how much space was freed.
function sizeOf(target: string): number {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(target).reduce((sum, name) => sum + sizeOf(path.join(target, name)), 0);
}

const toDelete: string[] = [];
for (const folder of GENERATED_FOLDERS) {
  if (!fs.existsSync(folder)) continue;
  for (const name of fs.readdirSync(folder)) {
    const item = path.join(folder, name);
    if (!deleteAll && item === KEEP) continue;
    toDelete.push(item);
  }
}

if (toDelete.length === 0) {
  console.log("🧹 Nothing to clean.");
  process.exit(0);
}

let freed = 0;
for (const item of toDelete) {
  freed += sizeOf(item);
  fs.rmSync(item, { recursive: true, force: true });
  console.log(`   deleted ${item}`);
}

const kept = !deleteAll && fs.existsSync(KEEP) ? `Kept the last report: ${KEEP}` : "No reports kept.";
const freedText = freed >= 1024 * 1024 ? `${(freed / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(freed / 1024)} KB`;
console.log(`🧹 Removed ${toDelete.length} old item(s), freed ${freedText}. ${kept}`);
