/**
 * Diagnostic: run one prompt on the RESUMED session directly via the SDK and
 * print the turn/end reason + any llm/retry events, to see why the model call
 * fails on a resumed session.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";

const REPO = "C:\\Users\\lc182\\Desktop\\deepseek_harness\\deepseek-harness";
const BIN = `${REPO}/packages/examples/jsonrpc-demo/src/bin.ts`;
const CONFIG = "C:\\Users\\lc182\\Desktop\\deepseek_harness\\harness-tui\\opencode-free.cordis.yml";
const SESSION = "session-fdcc4afd04bc431da8dd826ac1576986";

function apiKey(): string {
  try {
    const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    const text = readFileSync(join(home, ".credentials.yaml"), "utf8");
    const m = text.match(/^\s*OPENCODE_GO_API_KEY\s*:\s*['"]?([^'"\n\s]+)/m);
    return m?.[1] ?? "";
  } catch {
    return "";
  }
}

const model = process.env.TEST_MODEL ?? "mimo-v2.5-free";
const harness = new DeepSeekHarness({
  launch: {
    command: process.execPath,
    args: ["--import", "tsx/esm", BIN, CONFIG],
    cwd: REPO,
    requestTimeoutMs: 180_000,
    env: { ...process.env, OPENCODE_GO_API_KEY: apiKey() },
  },
  provider: "opencode",
  model,
});
await harness.start();
console.log(`[init] model=${model} session=${SESSION}`);
const t0 = Date.now();
const result = await harness.run("Reply with exactly: pong", {
  sessionId: SESSION,
  onNotification: (n) => {
    if (n.method === "session.event") {
      const ev = (n.params.event ?? {}) as { type?: string; data?: Record<string, unknown> };
      if (ev.type === "turn/end" || ev.type === "llm/retry" || ev.type === "llm/retry-started") {
        console.log(`[ev] ${ev.type}: ${JSON.stringify(ev.data)?.slice(0, 400)}`);
      }
    }
  },
});
console.log(`[run] done in ${Date.now() - t0}ms`);
console.log(`[finalResponse] ${JSON.stringify(result.finalResponse)?.slice(0, 300)}`);
console.log(`[events] ${result.events.length} events; last 3 types: ${result.events.slice(-3).map((e) => e.type).join(", ")}`);
await harness.close();
process.exit(0);
