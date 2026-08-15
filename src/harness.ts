/**
 * Reactive bridge: spawn the DeepSeek Harness jsonrpc-agent subprocess and fold
 * the full `session.event` stream into a structured, reactive session store the
 * VueTUI panel renders live. Model switching is a teardown + relaunch of the
 * runtime with a new `initialize` route, reusing the same persisted session id.
 */
import { realpathSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { reactive } from "vue";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { DeepSeekHarness, type HarnessNotification } from "@deepseek-ai/dsh-sdk-client";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./models";

// Resolve the DeepSeek Harness source checkout reliably regardless of whether
// this app runs from src (vite dev) or a built bundle (dist/main.mjs). Prefer an
// explicit override, else walk up from the module to the sibling checkout.
const MODULE_DIR = realpathSync(fileURLToPath(new URL(".", import.meta.url)));
function repoRoot(): string {
  if (process.env.DSH_REPO && existsSync(process.env.DSH_REPO)) return realpathSync(process.env.DSH_REPO);
  for (const p of [join(MODULE_DIR, ".."), join(MODULE_DIR, "..", "..")]) {
    const candidate = join(p, "deepseek-harness");
    if (existsSync(join(candidate, "pnpm-workspace.yaml"))) return candidate;
  }
  throw new Error("cannot locate the deepseek-harness checkout — set DSH_REPO to its path");
}
const REPO = repoRoot();
const BIN = `${REPO}/packages/examples/jsonrpc-demo/src/bin.ts`;
// Project root (harness-tui) = module dir's grandparent during dev (src/) or
// dist/ during build; the config lives beside it.
const PROJECT = realpathSync(join(MODULE_DIR, ".."));
// FREE OpenCode Zen (opencode) provider; *-free models cost 0.
// Default config enables the permission system (sandbox modes + approval asks)
// with danger-full-access as the default preset. Override with DSH_CONFIG.
const CONFIG = process.env.DSH_CONFIG
  ? resolve(process.env.DSH_CONFIG)
  : join(PROJECT, "opencode-sandbox.cordis.yml");

// ---------------------------------------------------------------------------
// Session persistence on disk
// ---------------------------------------------------------------------------
// The runtime (dsh-session-persistence-jsonl, compression none) writes one
// plaintext JSONL per session: a `{type:"session"}` header line, then raw
// SessionEvent envelopes `{type,seq,time,data}`. The TUI reads these to
// enumerate + restore sessions, mirroring the config's root expression.

/** Resolve the runtime's session root (config: `DSH_SESSION_ROOT ?? <default>`). */
function sessionRoot(): string {
  try {
    const text = readFileSync(CONFIG, "utf8");
    const m = text.match(/root:\s*!!js process\.env\.DSH_SESSION_ROOT \?\? '([^']+)'/);
    const def = m?.[1] ?? ".sessions";
    return resolve(REPO, process.env.DSH_SESSION_ROOT ?? def);
  } catch {
    return join(REPO, ".sessions");
  }
}

/** One discovered on-disk session. */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: number;
  active?: boolean;
}

interface SessionLog {
  id: string;
  createdAt: number;
  cwd?: string;
  title: string;
  updatedAt: number;
  turns: number;
  /** Raw SessionEvent envelopes (packed chunk rows skipped). */
  events: Array<Record<string, unknown>>;
}

function contentTextPlain(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const b of content) {
    if (b && typeof b === "object" && (b as Record<string, unknown>).type === "text") {
      text += String((b as Record<string, unknown>).text ?? "");
    }
  }
  return text.trim();
}

/** Parse one session's JSONL into a summary + event list. */
export function readSessionLog(log: string): SessionLog | undefined {
  try {
    const lines = readFileSync(log, "utf8").split("\n");
    if (lines.length < 1) return undefined;
    const header = JSON.parse(lines[0]!) as Record<string, unknown>;
    if (typeof header.id !== "string") return undefined;
    const result: SessionLog = {
      id: header.id,
      createdAt: typeof header.createdAt === "number" ? header.createdAt : 0,
      cwd: typeof header.cwd === "string" ? header.cwd : undefined,
      title: "",
      updatedAt: typeof header.createdAt === "number" ? header.createdAt : 0,
      turns: 0,
      events: [],
    };
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof rec.time === "number" && rec.time > result.updatedAt) result.updatedAt = rec.time;
      // Chunk rows (packed or not) are noise for the TUI restore: the durable
      // assistant/message carries the full text + reasoning.
      if (
        rec.type === "text-chunks" || rec.type === "reasoning-chunks" || rec.type === "tool-call-chunks"
        || rec.type === "assistant/chunk"
      ) continue;
      if (rec.type === "turn/start") result.turns += 1;
      if (!result.title) {
        const data = (rec.data ?? {}) as Record<string, unknown>;
        if (rec.type === "session/title" && typeof data.title === "string") {
          result.title = data.title;
        } else if (rec.type === "user/message" && (data.source as Record<string, unknown>)?.kind === "user") {
          const t = contentTextPlain(data.content);
          if (t) result.title = t.length > 60 ? `${t.slice(0, 60)}…` : t;
        }
      }
      result.events.push(rec);
    }
    return result;
  } catch {
    return undefined;
  }
}

/** Discover every persisted session's JSONL, newest-first. */
export function listSessionLogs(): Array<{ log: string; summary: SessionLog }> {
  const root = sessionRoot();
  const out: Array<{ log: string; summary: SessionLog }> = [];
  let projects: string[] = [];
  try {
    projects = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name));
  } catch {
    return out;
  }
  for (const project of projects) {
    let dirs: string[] = [];
    try {
      dirs = readdirSync(project, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(project, d.name));
    } catch {
      continue;
    }
    for (const dir of dirs) {
      const log = join(dir, "session.jsonl");
      if (!existsSync(log)) continue;
      const summary = readSessionLog(log);
      if (summary) out.push({ log, summary });
    }
  }
  out.sort((a, b) => b.summary.updatedAt - a.summary.updatedAt);
  return out;
}

interface TuiState {
  activeSessionId: string;
  titles: Record<string, string>;
  models?: UserModel[];
}
const stateFile = () => join(sessionRoot(), ".harness-tui-state.json");
function loadTuiState(): TuiState {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf8")) as TuiState;
  } catch {
    return { activeSessionId: "", titles: {} };
  }
}
function saveTuiState(state: TuiState): void {
  try {
    writeFileSync(stateFile(), JSON.stringify(state, null, 2));
  } catch {
    /* best-effort */
  }
}

/**
 * Add a custom provider + model the way the web does: write an `llm-pi-ai`
 * provider profile into the harness settings document (`<home>/settings.yaml`),
 * which the runtime hot-publishes (no restart). An api key value is appended to
 * `<home>/.credentials.yaml` so the profile's `apiKeyEnv` resolves.
 */
export function addCustomProvider(spec: {
  provider: string;
  api: string;
  baseURL: string;
  apiKeyEnv: string;
  apiKey: string;
  model: string;
  label: string;
}): void {
  const home = dshHome();
  const settingsPath = join(home, "settings.yaml");
  try {
    mkdirSync(home, { recursive: true });
  } catch {
    /* best-effort */
  }
  let doc: Record<string, unknown> = {};
  try {
    doc = yamlParse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    doc = {};
  }
  const llm = (doc["llm-pi-ai"] ?? {}) as Record<string, unknown>;
  const providers = (llm["providers"] ?? {}) as Record<string, unknown>;
  providers[spec.provider] = {
    ...(spec.api ? { api: spec.api } : {}),
    ...(spec.baseURL ? { baseURL: spec.baseURL } : {}),
    ...(spec.apiKeyEnv ? { apiKeyEnv: spec.apiKeyEnv } : {}),
    models: [{
      id: spec.model,
      ...(spec.label && spec.label !== spec.model ? { name: spec.label } : {}),
    }],
  };
  llm["providers"] = providers;
  doc["llm-pi-ai"] = llm;
  try {
    writeFileSync(settingsPath, yamlStringify(doc, { indent: 2 }) + "\n");
  } catch {
    /* best-effort */
  }
  if (spec.apiKey && spec.apiKeyEnv) {
    const credsPath = join(home, ".credentials.yaml");
    try {
      const existing = existsSync(credsPath) ? readFileSync(credsPath, "utf8") : "";
      if (!new RegExp(`^\\s*${spec.apiKeyEnv}\\s*:`).test(existing)) {
        const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
        writeFileSync(credsPath, existing + sep + `${spec.apiKeyEnv}: ${spec.apiKey}\n`);
      }
    } catch {
      /* best-effort */
    }
  }
  const st = loadTuiState();
  st.models ??= [];
  if (!st.models.some((m) => m.model === spec.model)) {
    st.models.push({
      provider: spec.provider,
      model: spec.model,
      label: spec.label || spec.model,
      group: spec.api || "custom",
      free: false,
    });
  }
  saveTuiState(st);
  refreshUserModels(st);
}

function refreshUserModels(st: TuiState): void {
  userModels.splice(0, userModels.length, ...(st.models ?? []));
}

/** One model listed by a provider's `/models` endpoint. */
export interface ProviderModel {
  id: string;
  name?: string;
}

/**
 * Fetch a provider's model list via its OpenAI-compatible (or Anthropic)
 * `/models` endpoint. Returns [] on any failure so the caller falls back to
 * manual entry.
 */
export async function fetchProviderModels(opts: {
  api?: string;
  baseURL: string;
  apiKey?: string;
}): Promise<ProviderModel[]> {
  const base = opts.baseURL.replace(/\/+$/, "");
  const url = opts.api === "anthropic-messages" ? `${base}/v1/models` : `${base}/models`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: opts.apiKey ? `Bearer ${opts.apiKey}` : "",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: unknown; name?: unknown; display_name?: unknown }> };
    if (!Array.isArray(body.data)) return [];
    return body.data
      .filter((m) => typeof m.id === "string" && m.id.length > 0)
      .map((m) => ({
        id: m.id as string,
        name:
          typeof m.name === "string"
            ? m.name
            : typeof m.display_name === "string"
              ? m.display_name
              : undefined,
      }));
  } catch {
    return [];
  }
}

function keyFromCreds(name: string): string {
  try {
    const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    const text = readFileSync(join(home, ".credentials.yaml"), "utf8");
    const m = text.match(new RegExp(`^\\s*${name}\\s*:\\s*['"]?([^'"\\n\\s]+)`, "m"));
    return m?.[1] ?? "";
  } catch {
    return "";
  }
}

function apiKey(): string {
  return process.env.OPENCODE_GO_API_KEY ?? keyFromCreds("OPENCODE_GO_API_KEY");
}

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** A user-configured custom model (via /model-add), shown alongside the catalog. */
export interface UserModel {
  provider: string;
  model: string;
  label: string;
  group: string;
  free?: boolean;
}

export const userModels = reactive<UserModel[]>([]);

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export interface ToolCall {
  callId: string;
  name: string;
  arguments: string;
  state: "running" | "done" | "error";
  /** Concatenated result text, when the tool returned any. */
  result?: string;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SubagentInfo {
  childSessionId: string;
  parentSessionId: string;
  state: "running" | "done" | "error";
  provider?: string;
}

/**
 * Whole-log figures, mirroring the web's `sessionStats` projection plus the
 * token/cache totals the bottom stats bar renders.
 */
export interface SessionStats {
  /** Distinct turns carrying at least one closed step. */
  turns: number;
  /** Closed steps (`step/end`). */
  steps: number;
  /** Summed model wall time (step/start → assistant/message), ms. */
  llmMs: number;
  /** Summed matched tool call→result wall time, ms. */
  toolMs: number;
  /** Summed first-token latency (step/start → first delta), ms. */
  ttftMs: number;
  /** Steps carrying a recorded first token. */
  ttftSteps: number;
  /** Summed decode wall time (first token → message), ms. */
  decodeMs: number;
  /** Summed output tokens over the decode-timed steps. */
  decodeTokens: number;
  /** Summed uncached input tokens. */
  inputTokens: number;
  /** Summed output tokens. */
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function freshStats(): SessionStats {
  return {
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

interface StatsFold {
  openStep: { turn: number; step: number; startTime: number; firstTokenTime: number | null } | null;
  lastTurn: number | null;
  pendingCalls: Record<string, number>;
}
const statsFolds = new WeakMap<SessionState, StatsFold>();
function foldOf(state: SessionState): StatsFold {
  let f = statsFolds.get(state);
  if (!f) {
    f = { openStep: null, lastTurn: null, pendingCalls: {} };
    statsFolds.set(state, f);
  }
  return f;
}

export interface Turn {
  turn: number;
  user?: string;
  assistant?: string;
  reasoning?: string;
  usage?: TokenUsage;
  tools: ToolCall[];
  endReason?: string;
  startedAt: number;
  endedAt?: number;
  /** Model that produced this turn's output (captured at request/context). */
  model?: string;
  /** Provider failure message when the turn ended in error (never silent). */
  endError?: string;
  /** Transient "model retrying" status while a request is being retried. */
  retry?: string;
}

export interface SessionState {
  status: "idle" | "running";
  provider: string;
  model: string;
  contextWindow?: number;
  /** The active session id (what `prompt` targets). */
  id: string;
  /** Display title of the active session. */
  title: string;
  turns: Turn[];
  /** Live (in-flight) turn; becomes a committed `turns` entry on `turn/end`. */
  current: Turn | null;
  todos: TodoItem[];
  subagents: SubagentInfo[];
  /** Whole-log stats shown in the bottom toolbar. */
  stats: SessionStats;
  /** Current permission preset (read-only / workspace-write / danger-full-access). */
  permissionPreset: string;
  /** A live permission ask awaiting the user's allow/reject. */
  pendingApproval: { id: string; toolName: string; callId?: string; reason?: string } | null;
  error: string | null;
}

export const session = reactive<SessionState>({
  status: "idle",
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODEL,
  contextWindow: undefined,
  id: "",
  title: "New session",
  turns: [],
  current: null,
  todos: [],
  subagents: [],
  stats: freshStats(),
  permissionPreset: "danger-full-access",
  pendingApproval: null,
  error: null,
});

/** Known sessions (disk + in-memory), newest-first; drives the session picker. */
export const sessions = reactive<SessionSummary[]>([]);

// ---------------------------------------------------------------------------
// Event fold
// ---------------------------------------------------------------------------

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
}

function usageFrom(raw: Record<string, unknown> | undefined): TokenUsage {
  return {
    inputTokens: num(raw?.inputTokens),
    outputTokens: num(raw?.outputTokens),
    cacheReadTokens: num(raw?.cacheReadTokens),
    cacheWriteTokens: num(raw?.cacheWriteTokens),
    reasoningTokens: num(raw?.reasoningTokens),
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Concatenate text blocks (plus reasoning blocks) out of a content-block array. */
function contentText(content: unknown): { text: string; reasoning: string } {
  let text = "";
  let reasoning = "";
  if (!Array.isArray(content)) return { text, reasoning };
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text") text += str(b.text);
    else if (b.type === "reasoning") reasoning += str(b.text);
  }
  return { text, reasoning };
}

/**
 * Fold one session event's contribution to the whole-log stats, mirroring the
 * web's `sessionStats` projection (step/end counts, step→message model time,
 * first-token latency, matched tool time) plus token/cache totals.
 */
function applyStats(state: SessionState, type: string, time: number, data: Record<string, unknown>): void {
  const s = state.stats;
  const f = foldOf(state);
  switch (type) {
    case "step/start":
      f.openStep = { turn: num(data.turn), step: num(data.step), startTime: time, firstTokenTime: null };
      break;
    case "assistant/chunk": {
      const open = f.openStep;
      if (!open) break;
      const chunk = data.chunk as Record<string, unknown> | undefined;
      if (!chunk) break;
      const isDelta =
        (chunk.type === "text-delta" || chunk.type === "reasoning-delta") && String(chunk.text ?? "") !== "";
      if (open.firstTokenTime === null && isDelta) open.firstTokenTime = time;
      break;
    }
    case "assistant/message": {
      const open = f.openStep;
      if (!open) break;
      s.llmMs += Math.max(0, time - open.startTime);
      const usage = data.usage as Record<string, unknown> | undefined;
      const outTok = usage ? num(usage.outputTokens) : 0;
      if (open.firstTokenTime !== null) {
        s.ttftMs += Math.max(0, open.firstTokenTime - open.startTime);
        s.ttftSteps += 1;
        if (outTok > 0) {
          s.decodeMs += Math.max(0, time - open.firstTokenTime);
          s.decodeTokens += outTok;
        }
      }
      if (usage) {
        s.inputTokens += num(usage.inputTokens);
        s.outputTokens += outTok;
        s.cacheReadTokens += num(usage.cacheReadTokens);
        s.cacheWriteTokens += num(usage.cacheWriteTokens);
      }
      f.openStep = null;
      break;
    }
    case "tool/call":
      f.pendingCalls[str(data.callId)] = time;
      break;
    case "tool/result": {
      const msg = data.message as Record<string, unknown> | undefined;
      const src = msg?.source as Record<string, unknown> | undefined;
      const blocks = msg?.content as Array<Record<string, unknown>> | undefined;
      const callId = str(src?.callId ?? blocks?.[0]?.toolCallId);
      if (Object.prototype.hasOwnProperty.call(f.pendingCalls, callId)) {
        const dispatched = f.pendingCalls[callId]!;
        delete f.pendingCalls[callId];
        s.toolMs += Math.max(0, time - dispatched);
      }
      break;
    }
    case "step/end": {
      const turn = num(data.turn);
      if (f.lastTurn !== turn) s.turns += 1;
      s.steps += 1;
      f.lastTurn = turn;
      f.openStep = null;
      break;
    }
    case "turn/end":
      f.pendingCalls = {};
      break;
  }
}

/**
 * Fold one JSON-RPC notification into a session state. Pure over `state`
 * (mutates it), so it is unit-testable without a runtime subprocess.
 */
export function applyEvent(state: SessionState, n: HarnessNotification): void {
  if (n.method === "session.status") {
    const status = n.params.status;
    if (status === "running" || status === "idle") state.status = status;
    return;
  }
  if (n.method === "subagent.started") {
    const child = str(n.params.childSessionId);
    state.subagents.push({
      childSessionId: child,
      parentSessionId: str(n.params.parentSessionId),
      state: "running",
    });
    return;
  }
  if (n.method === "subagent.finished") {
    const child = str(n.params.childSessionId);
    const target = state.subagents.find((s) => s.childSessionId === child);
    if (target) {
      target.state = n.params.status === "error" ? "error" : "done";
      target.provider = str(n.params.provider);
    }
    return;
  }
  if (n.method !== "session.event") return;
  const ev = n.params.event as { type?: string; time?: unknown; data?: Record<string, unknown> } | undefined;
  if (!ev || typeof ev.type !== "string") return;
  const type = ev.type;
  const data = (ev.data ?? {}) as Record<string, unknown>;
  applyStats(state, type, num(ev.time), data);

  if (type === "turn/start") {
    if (state.current && state.current.turn === -1) {
      // Optimistic turn created in prompt(); stamp the real turn number.
      state.current.turn = num(data.turn);
      if (!state.current.model) state.current.model = state.model;
    } else {
      // Synthetic/continuation turn with no optimistic entry.
      state.current = { turn: num(data.turn), tools: [], startedAt: Date.now(), model: state.model };
    }
    return;
  }

  if (type === "user/message") {
    const src = data.source as Record<string, unknown> | undefined;
    // Only the real human prompt counts as the turn's user text; synthetic
    // injected context (agent.inject) must not overwrite it.
    if (src?.kind === "user") {
      const { text } = contentText(data.content);
      if (state.current && text) state.current.user = text;
    }
    return;
  }

  if (type === "assistant/chunk") {
    const cur = state.current;
    if (!cur) return;
    const chunk = data.chunk as Record<string, unknown> | undefined;
    if (!chunk) return;
    if (chunk.type === "text-delta") cur.assistant = (cur.assistant ?? "") + str(chunk.text);
    else if (chunk.type === "reasoning-delta") cur.reasoning = (cur.reasoning ?? "") + str(chunk.text);
    else if (chunk.type === "usage") cur.usage = usageFrom(chunk.usage as Record<string, unknown> | undefined);
    else if (chunk.type === "finish" && typeof chunk.reason === "object" && chunk.reason !== null) {
      cur.endReason = str((chunk.reason as Record<string, unknown>).kind);
    }
    return;
  }

  if (type === "tool/call") {
    const cur = state.current;
    if (!cur) return;
    cur.tools.push({
      callId: str(data.callId),
      name: str(data.name),
      arguments: str(data.arguments),
      state: "running",
    });
    return;
  }

  if (type === "tool/result") {
    const cur = state.current;
    if (!cur) return;
    const msg = data.message as Record<string, unknown> | undefined;
    const src = msg?.source as Record<string, unknown> | undefined;
    const blocks = msg?.content as Array<Record<string, unknown>> | undefined;
    const block = blocks?.[0];
    const callId = str(src?.callId ?? block?.toolCallId);
    const resultText = contentText(block?.content).text;
    const isError = data.error !== undefined || block?.isError === true;
    const target = callId ? cur.tools.find((t) => t.callId === callId) : cur.tools[cur.tools.length - 1];
    if (target) {
      target.state = isError ? "error" : "done";
      if (resultText) target.result = resultText;
    }
    return;
  }

  if (type === "assistant/message") {
    const cur = state.current;
    if (!cur) return;
    const msg = data.message as Record<string, unknown> | undefined;
    const { text, reasoning } = contentText(msg?.content);
    // Text/reasoning deltas already streamed into cur; the durable message is
    // authoritative only as a fallback (replay/resume where no chunk arrived).
    if (!cur.assistant && text) cur.assistant = text;
    if (!cur.reasoning && reasoning) cur.reasoning = reasoning;
    const usage = usageFrom(data.usage as Record<string, unknown> | undefined);
    if (usage.inputTokens > 0 || usage.outputTokens > 0) cur.usage = usage;
    cur.retry = undefined;
    return;
  }

  if (type === "llm/retry" || type === "llm/retry-started") {
    const cur = state.current;
    if (cur) {
      const failure = (data.failure ?? {}) as Record<string, unknown>;
      cur.retry = `模型请求重试中：${str(failure.message) || str(failure.code) || "未知错误"}`;
    }
    return;
  }

  if (type === "turn/end") {
    const cur = state.current;
    if (!cur) return;
    cur.endedAt = Date.now();
    const reason = data.reason as Record<string, unknown> | undefined;
    cur.endReason = str(reason?.kind) || cur.endReason;
    const err = (reason?.failure ?? reason?.error) as Record<string, unknown> | undefined;
    if (err && (str(err.message) || str(err.code))) {
      cur.endError = str(err.message) || str(err.code) || "运行失败";
    }
    cur.retry = undefined;
    state.turns.push(cur);
    state.current = null;
    return;
  }

  if (type === "approval/asked") {
    state.pendingApproval = {
      id: str(data.id),
      toolName: str(data.toolName),
      callId: str(data.callId),
      reason: str(data.reason),
    };
    return;
  }

  if (type === "approval/decided") {
    state.pendingApproval = null;
    return;
  }

  if (type === "permission/preset") {
    const p = str(data.preset);
    if (p) state.permissionPreset = p;
    return;
  }

  if (type === "todo/write") {
    const todos = data.todos;
    if (Array.isArray(todos)) {
      state.todos = todos.map((t) => ({
        content: str((t as Record<string, unknown>).content),
        status: (t as Record<string, unknown>).status as TodoItem["status"],
      }));
    }
    return;
  }

  if (type === "request/context") {
    const provider = str(data.provider);
    const model = str(data.model);
    if (provider) state.provider = provider;
    if (model) {
      state.model = model;
      if (state.current) state.current.model = model;
    }
    if (typeof data.contextWindow === "number") state.contextWindow = data.contextWindow;
  }
}

const notify = (n: HarnessNotification) => {
  // Fold only the active session's events; background sessions stay invisible.
  if (n.method === "session.event" || n.method === "session.status") {
    const sid = String(n.params.sessionId ?? "");
    if (sid && sid !== session.id) return;
  }
  applyEvent(session, n);
};

// ---------------------------------------------------------------------------
// Session store / lifecycle
// ---------------------------------------------------------------------------

let harness: DeepSeekHarness | undefined;

function launchSpec(provider: string, model: string) {
  return {
    launch: {
      command: process.execPath,
      args: ["--import", "tsx/esm", BIN, CONFIG],
      cwd: REPO,
      requestTimeoutMs: 180_000,
      env: { ...process.env, OPENCODE_GO_API_KEY: apiKey() },
    },
    provider,
    model,
  };
}

/** Clear the in-memory view of the active session (keeps its id). */
function resetView(): void {
  session.turns.length = 0;
  session.todos.length = 0;
  session.subagents.length = 0;
  session.current = null;
  session.status = "idle";
  session.error = null;
  session.contextWindow = undefined;
  session.pendingApproval = null;
  session.permissionPreset = "danger-full-access";
  session.stats = freshStats();
  statsFolds.delete(session);
}

/** Refresh the `sessions` list from disk + in-memory, marking the active one. */
function refreshSessionList(): void {
  const st = loadTuiState();
  refreshUserModels(st);
  const logs = listSessionLogs();
  const next: SessionSummary[] = logs.map(({ summary }) => ({
    id: summary.id,
    title: st.titles[summary.id] ?? (summary.title || "New session"),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    turns: summary.turns,
    active: summary.id === session.id,
  }));
  // Keep fresh in-memory sessions that have not hit disk yet.
  for (const s of sessions) {
    if (s.id && !next.some((x) => x.id === s.id)) next.push({ ...s, active: s.id === session.id });
  }
  sessions.splice(0, sessions.length, ...next);
}

/** Make `id` the active session: reset the view and replay its persisted log. */
function activateSession(id: string): void {
  resetView();
  session.id = id;
  const st = loadTuiState();
  const found = listSessionLogs().find((l) => l.summary.id === id);
  if (found) {
    for (const ev of found.summary.events) {
      applyEvent(session, { method: "session.event", params: { sessionId: id, event: ev } });
    }
    session.title = st.titles[id] ?? (found.summary.title || "New session");
  } else {
    session.title = st.titles[id] ?? "New session";
  }
  refreshSessionList();
}

/**
 * Persisted session to auto-resume on launch, or "" when the recorded id never
 * hit disk. A session without a single turn is never persisted (only `prompt`
 * records the active id), so an empty recorded id must not come back.
 */
export function pickResumeId(
  st: { activeSessionId?: string },
  logs: Array<{ summary: { id: string } }>,
): string {
  const id = st.activeSessionId;
  if (!id) return "";
  return logs.some((l) => l.summary.id === id) ? id : "";
}

/**
 * Resume the last persisted session into the active view. Only sessions that
 * actually ran a turn exist on disk; a recorded-but-never-used id (an empty
 * session) is ignored so a relaunch starts fresh instead of resurrecting a
 * blank session.
 */
function resumeLastSession(): boolean {
  const id = pickResumeId(loadTuiState(), listSessionLogs());
  if (!id) return false;
  activateSession(id);
  return true;
}

export async function connect(
  provider = session.provider,
  model = session.model,
  opts?: { freshSession?: boolean },
): Promise<void> {
  if (harness) await disconnect();
  harness = new DeepSeekHarness(launchSpec(provider, model));
  await harness.start();
  session.provider = provider;
  session.model = model;
  session.status = "idle";
  session.error = null;
  // A fresh launch resumes the last persisted session; a model switch keeps
  // the current one. Empty sessions that never ran a turn are never persisted,
  // so they are not candidates and the relaunch falls back to a new session.
  if (opts?.freshSession || !session.id) {
    if (opts?.freshSession || !resumeLastSession()) {
      session.id = `session-${randomUUID().replaceAll("-", "")}`;
      session.title = "New session";
      resetView();
      // Not recorded as the remembered active session: an empty session must
      // not survive restarts. `prompt` records it once it carries a turn.
    }
  }
  refreshSessionList();
}

export async function switchModel(model: string, provider = session.provider): Promise<void> {
  if (provider === session.provider && model === session.model) return;
  await connect(provider, model);
}

export async function prompt(text: string): Promise<void> {
  if (!harness) return;
  if (!session.id) session.id = `session-${randomUUID().replaceAll("-", "")}`;
  // First turn of a session: it now carries content, so remember it as the
  // active session (the runtime persists it once the run starts). Empty
  // sessions are never recorded and thus never come back on relaunch.
  const st = loadTuiState();
  if (st.activeSessionId !== session.id) saveTuiState({ ...st, activeSessionId: session.id });
  // Optimistic turn: the user's message shows immediately; `turn/start` stamps
  // the real turn number when the loop claims the queued input.
  session.current = { turn: -1, user: text, tools: [], startedAt: Date.now(), model: session.model };
  try {
    await harness.run(text, { sessionId: session.id, onNotification: notify });
    refreshSessionList();
  } catch (err) {
    session.error = String(err);
  }
}

export async function disconnect(): Promise<void> {
  await harness?.close();
  harness = undefined;
  session.status = "idle";
}

/** Clear the active session's in-memory view (same persisted session id). */
export function clear(): void {
  resetView();
}

/** Switch the active session (persisted or fresh) and remember it. */
export function switchSession(id: string): void {
  if (id === session.id) return;
  activateSession(id);
  saveTuiState({ ...loadTuiState(), activeSessionId: id });
}

/** Start a brand-new session. Empty until the first turn, so it is not
 * remembered across restarts: the previous persisted session stays the launch
 * default until this one runs a turn (`prompt` records it). */
export function newSession(): void {
  session.id = `session-${randomUUID().replaceAll("-", "")}`;
  session.title = "New session";
  resetView();
  refreshSessionList();
}

/** User-provided title for the active session (stored TUI-side, survives restarts). */
export function renameSession(title: string): void {
  const st = loadTuiState();
  st.titles[session.id] = title;
  saveTuiState(st);
  session.title = title;
  refreshSessionList();
}

/**
 * Switch the active session's permission preset (sandbox mode + approval
 * policy), mirroring the web `/permission` command. No-op false when the
 * runtime doesn't compose the permission service. Never rejects — failures
 * surface in `session.error`.
 */
export async function setPermission(preset: string): Promise<boolean> {
  if (!harness) return false;
  // Optimistic: reflect the picked preset immediately. The runtime's
  // `permission/preset` event only streams while a run subscription is active,
  // so without this the composer would keep showing the old mode.
  const previous = session.permissionPreset;
  session.permissionPreset = preset;
  try {
    const ok = await harness.setPermission(session.id, preset);
    if (!ok) {
      session.permissionPreset = previous;
      session.error = `权限切换未被接受：${preset}`;
    }
    return ok;
  } catch (err) {
    session.permissionPreset = previous;
    session.error = `权限切换失败：${String(err)}`;
    return false;
  }
}

/** Answer the current approval ask (`session.pendingApproval`). Never rejects. */
export async function respondToApproval(approvalId: string, decision: "allow" | "reject"): Promise<boolean> {
  if (!harness) return false;
  try {
    return await harness.respondToApproval(session.id, approvalId, decision);
  } catch (err) {
    session.error = `审批应答失败：${String(err)}`;
    return false;
  }
}

/**
 * Truly abort the agent's running turn: the runtime stops the model call and
 * emits an `aborted` turn/end (already-streamed content is retained). Never
 * rejects.
 */
export async function abortSession(): Promise<boolean> {
  if (!harness) return false;
  try {
    return await harness.abortSession(session.id);
  } catch (err) {
    session.error = `取消失败：${String(err)}`;
    return false;
  }
}
