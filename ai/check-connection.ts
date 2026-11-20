// A tiny "smoke test" for our AI setup: ask one short question and print the answer.
// Run it with:  npm run ai:check            (your subscription, via Claude Code)
//          or:  AI_MODE=api npm run ai:check (the Claude API key)

import { z } from "zod";
import { askStructured, describeMode } from "ai-qa";

console.log(`Checking: ${describeMode()}`);
try {
  const { data, costUsd, billed } = await askStructured({
    system: "You are a helpful QA assistant.",
    prompt: "Are you ready to help with QA testing? Reply in one short sentence.",
    schema: z.object({ reply: z.string() }),
    effort: "low",
  });
  console.log("Claude says:", data.reply);
  console.log(`✅ Connection works. ${billed ? `API cost: $${costUsd.toFixed(4)}` : "No API credits used."}`);
} catch (error) {
  console.error("❌", error instanceof Error ? error.message : error);
  process.exit(1);
}
