// Starts Playwright and npm the same way on Linux, macOS and Windows.
//
// Why not just spawn("npx", ...)? On Windows "npx" and "npm" are .cmd files, which
// Node can only start through a shell, and a shell changes how arguments are quoted.
// Running their JavaScript entry files with the current Node avoids both problems.

import path from "node:path";

/** Node + Playwright's CLI file: use as spawn(cmd, [...args, "test", ...]) */
export function playwrightCommand(): { cmd: string; args: string[] } {
  return { cmd: process.execPath, args: [path.resolve("node_modules/@playwright/test/cli.js")] };
}

/** Node + npm's CLI file (npm tells us where it is when it runs our script) */
export function npmCommand(): { cmd: string; args: string[]; shell: boolean } {
  const npmCli = process.env.npm_execpath;
  if (npmCli && npmCli.endsWith(".js")) return { cmd: process.execPath, args: [npmCli], shell: false };
  // Started without npm (e.g. "npx tsx ..."): fall back to the npm command itself
  return { cmd: "npm", args: [], shell: process.platform === "win32" };
}
