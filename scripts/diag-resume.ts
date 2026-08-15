/**
 * Diagnostic: run one prompt on the RESUMED session directly via the SDK and
 * print the turn/end reason + any llm/retry events, to see why the model call
 * fails on a resumed session.
 *
 * No absolute paths or session ids are hardcoded:
 *   DSH_REPO     - sibling deepseek-harness checkout (default: ../deepseek-harness)
 *   DSH_CONFIG   - cordis composition to run (default: opencode-free.cordis.yml)
 *   TEST_SESSION - session id to resume (required)
 *   TEST_MODEL   - model override (default: mimo-v2.5-free)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";

const REPO = process.env.DSH_REPO ?? resolve(process.cwd(), "..", "deepseek-harness");
const BIN = `${REPO}/packages/examples/jsonrpc-demo/src/bin.ts`;
const CONFIG = process.env.DSH_CONFIG ?? "opencode-free.cordis.yml";
const SESSION = process.env.TEST_SESSION ?? "";

if (!SESSION) {
  console.error("[usage] set TEST_SESSION=<session-id> to resume a session");
  process.exit(2);
}

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
