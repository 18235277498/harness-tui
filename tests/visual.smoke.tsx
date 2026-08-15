/**
 * Visual inspection: render the real app.vue against an emulated terminal with
 * rich mock data and dump the painted frames so the layout can be eyeballed
 * (and improved) without a TTY. Not a pass/fail test.
 */
import { reactive } from "vue";
import { describe, test, vi } from "vitest";
import { appendFileSync } from "node:fs";
import { render } from "@vue-tui/testing";
import App from "../src/app.vue";

const OUT = process.env.HARNESS_TUI_FRAMES ?? `${process.env.TEMP}/harness-tui-frames.txt`;

vi.mock("../src/harness", () => {
  const session = reactive({
    status: "idle",
    provider: "opencode",
    model: "deepseek-v4-flash-free",
    contextWindow: 262144,
    id: "session-abcd1234",
    title: "Add a CSV parser",
    turns: [],
    current: null,
    todos: [],
    subagents: [],
    stats: { turns: 3, steps: 12, llmMs: 61000, toolMs: 25000, ttftMs: 5400, ttftSteps: 3, decodeMs: 20000, decodeTokens: 2300, inputTokens: 110000000, outputTokens: 172000, cacheReadTokens: 110000000, cacheWriteTokens: 0 },
    permissionPreset: "workspace-write",
    pendingApproval: null,
    error: null,
  });
  const sessions = reactive([] as Array<{ id: string; title: string; createdAt: number; updatedAt: number; turns: number; active?: boolean }>);
  const userModels = reactive([] as Array<{ provider: string; model: string; label: string; group: string; free?: boolean }>);
  return {
    connect: async () => {},
    disconnect: async () => {},
    prompt: async () => {},
    switchModel: async () => {},
    switchSession: () => {},
    newSession: () => {},
    renameSession: () => {},
    setPermission: async () => true,
    respondToApproval: async () => true,
    abortSession: async () => true,
    addCustomProvider: () => {},
    clear: () => {},
    session,
    sessions,
    userModels,
  };
});

import { session, sessions, userModels } from "../src/harness";

const TURN1_ANSWER = `## CSV Parser

Here is the implementation:

\`\`\`ts
export function parseCsv(input: string): string[][] {
  return input
    .split("\\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
}
\`\`\`

Key points:

- Handles quoted fields correctly
- Skips empty lines
- Supports streaming of large files

### Error handling

Wrap the body in a \`try/catch\` and rethrow with context.`;

function seed(): void {
  session.status = "idle";
  session.current = null;
  session.error = null;
  session.id = "session-abcd1234";
  session.title = "Add a CSV parser";
  sessions.splice(0, sessions.length,
    { id: "session-abcd1234", title: "Add a CSV parser", createdAt: Date.now() - 7200_000, updatedAt: Date.now() - 3_600_000, turns: 2, active: true },
    { id: "session-bbbb1111", title: "Benchmark the parser on 50MB", createdAt: Date.now() - 86_400_000, updatedAt: Date.now() - 8_640_000, turns: 1 },
    { id: "session-cccc2222", title: "Fix the edge case with quoted commas", createdAt: Date.now() - 172_800_000, updatedAt: Date.now() - 172_800_000, turns: 3 },
  );
  session.turns = [
    {
      turn: 1,
      user: "Write a TypeScript function that parses CSV strings into rows of cells.",
      assistant: TURN1_ANSWER,
      reasoning: "The user wants a CSV parser. I will write a compact implementation and cover quoting, then list the key behaviors.",
      usage: { inputTokens: 184, outputTokens: 96, cacheReadTokens: 150, cacheWriteTokens: 12, reasoningTokens: 31 },
      tools: [
        { callId: "c1", name: "read", arguments: "{}", state: "done", result: "3 files, 1200 lines" },
        { callId: "c2", name: "bash", arguments: "{\"command\":\"npm test\"}", state: "done" },
      ],
      endReason: "stop",
      startedAt: Date.now() - 120_000,
      endedAt: Date.now() - 90_000,
    },
    {
      turn: 2,
      user: "Now add robust error handling for malformed input.",
      assistant: "Wrap the parser in error handling:\n\n```ts\nexport function parseCsv(input: string): string[][] {\n  try {\n    return tokenize(input);\n  } catch (e) {\n    throw new CsvError(\"failed to parse\", { cause: e });\n  }\n}\n```",
      reasoning: "Add a typed error and a try/catch around the tokenizer.",
      usage: { inputTokens: 240, outputTokens: 55, cacheReadTokens: 0, cacheWriteTokens: 3, reasoningTokens: 9 },
      tools: [{ callId: "c3", name: "edit", arguments: "{}", state: "done", result: "applied to src/csv.ts" }],
      endReason: "stop",
      endError: "503 status code (no body)",
      startedAt: Date.now() - 60_000,
      endedAt: Date.now() - 30_000,
    },
  ];
  session.todos = [
    { content: "Write CSV parser", status: "completed" },
    { content: "Add error handling", status: "in_progress" },
    { content: "Add unit tests", status: "pending" },
  ];
}

function dump(label: string, lines: string[]): void {
  const block = [`\n========== ${label} ==========`, ...lines.map((line, i) => `${String(i + 1).padStart(3)}│${line}`), `========== end ${label} ==========`];
  appendFileSync(OUT, block.join("\n") + "\n");
}

describe("visual inspection (non-asserting)", () => {
  test("idle conversation view", async () => {
    seed();
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    const screen = await result.screen();
    dump("IDLE", screen.lines);
    result.dispose();
  });

  test("live running turn", async () => {
    seed();
    session.status = "running";
    session.current = {
      turn: 3,
      user: "Great, now benchmark it against a 50MB file.",
      reasoning: "The user wants a benchmark. I will add a small script and run it once to get numbers.",
      assistant: "Let me add a benchmark script and run it:\n\n```sh\nnode bench.ts data-50mb.csv\n```\n\nDone — ",
      tools: [
        { callId: "c4", name: "read", arguments: "{}", state: "done", result: "ok" },
        { callId: "c5", name: "bash", arguments: "{\"command\":\"node bench.ts\"}", state: "running" },
      ],
      usage: { inputTokens: 310, outputTokens: 27, cacheReadTokens: 280, cacheWriteTokens: 0, reasoningTokens: 12 },
      startedAt: Date.now() - 8_000,
    };
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    const screen = await result.screen();
    dump("RUNNING", screen.lines);
    result.dispose();
  });

  test("model switcher overlay", async () => {
    seed();
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    await result.stdin.write("\u0018"); // ctrl+x
    const screen = await result.screen();
    dump("MODEL", screen.lines);
    result.dispose();
  });

  test("command palette overlay", async () => {
    seed();
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    await result.stdin.write("/");
    const screen = await result.screen();
    dump("COMMAND", screen.lines);
    result.dispose();
  });

  test("welcome screen (empty session)", async () => {
    session.turns = [];
    session.current = null;
    session.todos = [];
    session.title = "我的第一个会话";
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    const screen = await result.screen();
    dump("WELCOME", screen.lines);
    result.dispose();
  });

  test("tool details expanded (ctrl+t)", async () => {
    seed();
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    await result.stdin.write("\u0014"); // ctrl+t
    const screen = await result.screen();
    dump("TOOLS", screen.lines);
    result.dispose();
  });

  test("reasoning expanded (ctrl+r)", async () => {
    seed();
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    await result.stdin.write("\u0012"); // ctrl+r
    const screen = await result.screen();
    dump("REASONING", screen.lines);
    result.dispose();
  });

  test("approval banner + permission picker", async () => {
    seed();
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    session.pendingApproval = { id: "a1", toolName: "bash", reason: "运行：rm -rf tmp" };
    await new Promise((r) => setTimeout(r, 30));
    const screen1 = await result.screen();
    dump("APPROVAL", screen1.lines);
    // clear the ask, then open the permission picker via /permission
    session.pendingApproval = null;
    await result.stdin.write("/");
    await result.stdin.write("permission");
    await result.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    const screen2 = await result.screen();
    dump("PERMISSION", screen2.lines);
    result.dispose();
  });

  test("model-add form + custom model in switcher", async () => {
    seed();
    userModels.splice(0, userModels.length, { provider: "test-gw", model: "test-model", label: "Test Model", group: "custom" });
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    // open the model-add form via /modeladd
    await result.stdin.write("/");
    await result.stdin.write("modeladd");
    await result.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    const screen1 = await result.screen();
    dump("MODELADD", screen1.lines);
    // leave the form, then open the model switcher (ctrl+x); custom model listed
    await result.stdin.write("\u001b");
    await result.stdin.write("\u0018");
    await new Promise((r) => setTimeout(r, 30));
    const screen2 = await result.screen();
    dump("MODELSWITCH_CUSTOM", screen2.lines);
    result.dispose();
  });

  test("composer shows permission mode before model", async () => {
    seed();
    session.permissionPreset = "workspace-write";
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    const screen = await result.screen();
    dump("COMPOSER_PERM", screen.lines);
    result.dispose();
  });

  test("model-add popup: provider pick + mainstream form", async () => {
    seed();
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    await result.stdin.write("/");
    await result.stdin.write("modeladd");
    await result.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    const s1 = await result.screen();
    dump("MODELADD_PICK", s1.lines);
    // pick DeepSeek (down x2 → index 2), enter
    await result.stdin.write("\u001b[B");
    await result.stdin.write("\u001b[B");
    await result.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    const s2 = await result.screen();
    dump("MODELADD_FORM", s2.lines);
    // type an api key, dump the popup with the input shown inside
    await result.stdin.write("sk-test-key");
    await new Promise((r) => setTimeout(r, 30));
    const s3 = await result.screen();
    dump("MODELADD_POPUP_INPUT", s3.lines);
    await result.stdin.write("\r");
    await result.stdin.write("\r");
    await result.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    const s4 = await result.screen();
    dump("MODELADD_DONE", s4.lines);
    result.dispose();
  });

  test("fresh session overlays not blocked by welcome", async () => {
    session.turns = [];
    session.current = null;
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    await result.stdin.write("\u0018"); // ctrl+x → model switcher
    await new Promise((r) => setTimeout(r, 30));
    const s1 = await result.screen();
    dump("FRESH_MODEL", s1.lines);
    result.dispose();
  });

  test("fresh session /modeladd popup not blocked by welcome", async () => {
    session.turns = [];
    session.current = null;
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    await result.stdin.write("/");
    await result.stdin.write("modeladd");
    await result.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    const s = await result.screen();
    dump("FRESH_MODELADD", s.lines);
    result.dispose();
  });

  test("session picker overlay", async () => {    seed();
    const result = await render(App, { mode: "fullscreen", columns: 110, rows: 30 });
    await result.stdin.write("/");
    await result.stdin.write("sessions");
    await result.stdin.write("\r");
    const screen = await result.screen();
    dump("SESSIONS", screen.lines);
    result.dispose();
  });
});
