/**
 * P7 acceptance: persisted JSONL sessions are read back and replayed into a
 * fresh session state (title from first user message, turns, usage), so
 * switching sessions restores the conversation.
 */
import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEvent, readSessionLog, type SessionState } from "../src/harness";

function fresh(): SessionState {
  return {
    status: "idle",
    provider: "opencode",
    model: "deepseek-v4-flash-free",
    contextWindow: undefined,
    id: "s2",
    title: "New session",
    turns: [],
    current: null,
    todos: [],
    subagents: [],
    stats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    permissionPreset: "danger-full-access",
    error: null,
  };
}

const HEADER = `{"type":"session","version":0,"id":"session-s2","createdAt":1700000000000,"cwd":"C:\\\\proj","delegationDepth":0}`;

function ev(type: string, seq: number, data: Record<string, unknown>): string {
  return JSON.stringify({ type, seq, time: 1700000000000 + seq, data });
}

const LOG = [
  HEADER,
  ev("turn/start", 0, { turn: 1 }),
  ev("user/message", 1, { content: [{ type: "text", text: "Add a CSV parser" }], source: { kind: "user" } }),
  ev("step/start", 2, { turn: 1, step: 1 }),
  ev("assistant/chunk", 3, { chunk: { type: "text-delta", text: "Here is the parser." } }),
  ev("assistant/message", 4, {
    message: { content: [{ type: "text", text: "Here is the parser." }] },
    usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 5, reasoningTokens: 8 },
  }),
  ev("tool/call", 5, { callId: "c1", name: "read", arguments: "{}" }),
  ev("tool/result", 6, {
    message: { source: { kind: "tool", callId: "c1" }, content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "ok" }] }] },
  }),
  ev("step/end", 7, { turn: 1, step: 1 }),
  ev("turn/end", 8, { turn: 1, reason: { kind: "stop" } }),
  ev("request/context", 9, { provider: "opencode", model: "deepseek-v4-pro", contextWindow: 262144 }),
].join("\n");

describe("session persistence readback", () => {
  test("parses a persisted JSONL into summary + replayable events", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-session-"));
    const file = join(dir, "session.jsonl");
    writeFileSync(file, LOG);
    try {
      const log = readSessionLog(file);
      expect(log).toBeDefined();
      expect(log!.id).toBe("session-s2");
      expect(log!.createdAt).toBe(1700000000000);
      expect(log!.title).toBe("Add a CSV parser");
      expect(log!.turns).toBe(1);
      expect(log!.updatedAt).toBe(1700000000009);
      // The `assistant/chunk` row is skipped on restore (durable message carries the text).
      expect(log!.events).toHaveLength(9);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("replays a persisted log into a fresh session state", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-session-"));
    const file = join(dir, "session.jsonl");
    writeFileSync(file, LOG);
    try {
      const log = readSessionLog(file);
      const s = fresh();
      for (const e of log!.events) applyEvent(s, { method: "session.event", params: { sessionId: "s2", event: e } });
      expect(s.turns).toHaveLength(1);
      expect(s.turns[0]!.user).toBe("Add a CSV parser");
      expect(s.turns[0]!.assistant).toBe("Here is the parser.");
      expect(s.turns[0]!.usage?.cacheReadTokens).toBe(100);
      expect(s.turns[0]!.tools[0]?.name).toBe("read");
      expect(s.turns[0]!.tools[0]?.state).toBe("done");
      expect(s.model).toBe("deepseek-v4-pro");
      expect(s.contextWindow).toBe(262144);
      expect(s.stats.turns).toBe(1);
      expect(s.stats.steps).toBe(1);
      expect(s.stats.llmMs).toBeGreaterThan(0);
      expect(s.stats.toolMs).toBeGreaterThan(0);
      // Chunk rows are skipped on restore, so first-token latency is 0 for replayed history.
      expect(s.stats.ttftSteps).toBe(0);
      expect(s.stats.inputTokens).toBe(120);
      expect(s.stats.outputTokens).toBe(30);
      expect(s.stats.cacheReadTokens).toBe(100);
      expect(s.stats.cacheWriteTokens).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
