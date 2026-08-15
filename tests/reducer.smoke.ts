/**
 * P1 acceptance: the `applyEvent` fold turns the raw `session.event` stream
 * into structured turns with per-turn usage (cache hits), todos, and route
 * context — without a runtime subprocess or a TTY.
 */
import { describe, expect, test } from "vitest";
import { applyEvent, type SessionState } from "../src/harness";

function fresh(): SessionState {
  return {
    status: "idle",
    provider: "opencode",
    model: "deepseek-v4-flash-free",
    contextWindow: undefined,
    id: "s1",
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

function event(type: string, data: Record<string, unknown>) {
  return { method: "session.event", params: { sessionId: "s1", event: { type, data } } };
}

describe("applyEvent fold", () => {
  test("folds a full turn with streamed text and cache-hit usage", () => {
    const s = fresh();
    applyEvent(s, { method: "session.status", params: { sessionId: "s1", status: "running" } });
    expect(s.status).toBe("running");

    applyEvent(s, event("turn/start", { turn: 1 }));
    expect(s.current?.turn).toBe(1);

    applyEvent(s, event("user/message", { content: [{ type: "text", text: "hi there" }], source: { kind: "user" } }));
    expect(s.current?.user).toBe("hi there");

    applyEvent(s, event("assistant/chunk", { chunk: { type: "reasoning-delta", text: "let me think" } }));
    applyEvent(s, event("assistant/chunk", { chunk: { type: "text-delta", text: "hello" } }));
    applyEvent(s, event("assistant/chunk", { chunk: { type: "text-delta", text: " world" } }));
    applyEvent(s, event("assistant/chunk", {
      chunk: {
        type: "usage",
        usage: { inputTokens: 20, outputTokens: 7, cacheReadTokens: 15, cacheWriteTokens: 2, reasoningTokens: 3 },
      },
    }));

    applyEvent(s, event("assistant/message", {
      message: { content: [{ type: "text", text: "hello world" }] },
      usage: { inputTokens: 20, outputTokens: 7, cacheReadTokens: 15, cacheWriteTokens: 2, reasoningTokens: 3 },
    }));

    applyEvent(s, event("tool/call", { callId: "c1", name: "read", arguments: "{}" }));
    applyEvent(s, event("tool/result", {
      message: { source: { kind: "tool", callId: "c1" }, content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "ok" }] }] },
    }));

    applyEvent(s, event("turn/end", { turn: 1, reason: { kind: "stop" } }));

    expect(s.current).toBeNull();
    expect(s.turns).toHaveLength(1);
    const t = s.turns[0]!;
    expect(t.turn).toBe(1);
    expect(t.user).toBe("hi there");
    expect(t.assistant).toBe("hello world");
    expect(t.reasoning).toBe("let me think");
    expect(t.endReason).toBe("stop");
    expect(t.usage?.cacheReadTokens).toBe(15);
    expect(t.usage?.cacheWriteTokens).toBe(2);
    expect(t.usage?.inputTokens).toBe(20);
    expect(t.tools).toHaveLength(1);
    expect(t.tools[0]?.state).toBe("done");
    expect(t.tools[0]?.result).toBe("ok");
  });

  test("stamps an optimistic turn and records route context + todos", () => {
    const s = fresh();
    s.current = { turn: -1, user: "queued", tools: [], startedAt: 0 };
    applyEvent(s, event("turn/start", { turn: 7 }));
    expect(s.current?.turn).toBe(7);
    expect(s.current?.user).toBe("queued");

    applyEvent(s, event("request/context", { provider: "opencode", model: "deepseek-v4-pro", contextWindow: 262144 }));
    expect(s.provider).toBe("opencode");
    expect(s.model).toBe("deepseek-v4-pro");
    expect(s.contextWindow).toBe(262144);

    applyEvent(s, event("todo/write", { todos: [{ content: "do it", status: "in_progress" }] }));
    expect(s.todos).toEqual([{ content: "do it", status: "in_progress" }]);
  });
});
