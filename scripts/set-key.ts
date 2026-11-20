// Asks for your Claude API key (hidden while you paste) and saves it to .env
// Works the same on Linux, macOS and Windows.  Run it with:  npm run ai:set-key

import fs from "node:fs";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const input = process.stdin;
    process.stdout.write(question);
    if (!input.isTTY) {
      // Not an interactive terminal (e.g. piped input): just read one line
      let text = "";
      input.setEncoding("utf8");
      input.on("data", (d) => (text += d));
      input.on("end", () => resolve(text));
      return;
    }
    input.setRawMode(true); // read key by key, without showing anything
    input.setEncoding("utf8");
    let text = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          return resolve(text);
        }
        if (ch === "\u0003") process.exit(130); // Ctrl+C
        if (ch === "\u007f" || ch === "\b") text = text.slice(0, -1); // Backspace
        else text += ch;
      }
    };
    input.on("data", onData);
    input.resume();
  });
}

const key = (await askHidden("Paste your API key and press Enter (it stays hidden): ")).replace(/[\s"']/g, "");
if (!key.startsWith("sk-ant-")) {
  console.log("❌ That doesn't look like a Claude API key (it should start with sk-ant-). Nothing was saved.");
  process.exit(1);
}
fs.writeFileSync(".env", `ANTHROPIC_API_KEY=${key}\n`, { mode: 0o600 });
console.log("✅ Key saved to .env (git-ignored, never committed)");
