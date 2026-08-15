<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { Box, Color, Text, useApp, useInput } from "@vue-tui/runtime";
import { ScrollBox } from "@vue-tui/components";
import Markdown from "./Markdown.vue";
import { MODEL_CATALOG } from "./models";
import { theme } from "./theme";
import {
  connect,
  disconnect,
  prompt,
  session,
  sessions,
  switchModel,
  switchSession,
  newSession,
  renameSession,
  clear,
  setPermission,
  respondToApproval,
  abortSession,
  addCustomProvider,
  fetchProviderModels,
  userModels,
  type Turn,
} from "./harness";

const { exit } = useApp();
const scroll = shallowRef<{ scrollToBottom: () => void } | null>(null);
const inputText = ref("");
const history = ref<string[]>([]);
const histIdx = ref(-1);
const busy = ref(false);
const connected = ref(false);

// Modal mode: "chat" | "model" | "command" | "sessions" | "rename" | "permission" | "modeladd"
const mode = ref<"chat" | "model" | "command" | "sessions" | "rename" | "permission" | "modeladd">("chat");

// Double-Esc truly aborts a running turn (streamed content is retained) or,
// when idle, clears the session view.
const escAt = ref(0);
function cancelRun() {
  escAt.value = 0;
  if (busy.value) {
    // The runtime aborts the model call; its `aborted` turn/end commits the
    // already-streamed content into the conversation.
    void abortSession();
  } else {
    clear();
  }
}

// Reasoning visibility: ctrl+r toggles ALL turns' thinking (default collapsed).
const showReasoning = ref(false);
// Expand all tool call bodies (args + result); ctrl+t toggles.
const showToolDetails = ref(false);

function fmtArgs(args: string): string {
  if (!args) return "";
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

// ---- model switcher state ----
const modelQuery = ref("");
const modelSelIdx = ref(0);
const allModels = computed(() => [
  ...MODEL_CATALOG,
  ...userModels.map((m) => ({ model: m.model, label: m.label, group: m.group || "custom", free: m.free ?? false })),
]);
const filteredModels = computed(() => {
  const q = modelQuery.value.trim().toLowerCase();
  if (!q) return allModels.value;
  return allModels.value.filter((m) => m.model.includes(q) || m.label.toLowerCase().includes(q));
});
const MODEL_WINDOW = 12;
const modelWindow = computed(() => {
  const list = filteredModels.value;
  const start = Math.max(0, Math.min(modelSelIdx.value - Math.floor(MODEL_WINDOW / 2), list.length - MODEL_WINDOW));
  const end = Math.min(list.length, start + MODEL_WINDOW);
  return list.slice(start, end).map((m, i) => ({ m, idx: start + i }));
});

// ---- command palette state ----
const COMMANDS = [
  { id: "new", label: "新会话", hint: "开始一个全新的持久化会话" },
  { id: "sessions", label: "切换会话", hint: "列出并选择会话" },
  { id: "model", label: "切换模型", hint: "更换 provider 模型" },
  { id: "modeladd", label: "配置新模型", hint: "添加自定义 provider/模型" },
  { id: "think", label: "显示思考", hint: "切换显示/隐藏思考过程" },
  { id: "permission", label: "权限模式", hint: "切换权限预设（只读/默认/全权）" },
  { id: "rename", label: "重命名会话", hint: "为当前会话设置标题" },
  { id: "clear", label: "清空消息", hint: "清空当前视图" },
  { id: "quit", label: "退出", hint: "退出 harness-tui" },
] as const;
const cmdQuery = ref("");
const cmdSelIdx = ref(0);
const filteredCommands = computed(() => {
  const q = cmdQuery.value.trim().toLowerCase();
  if (!q) return [...COMMANDS];
  return COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.id.includes(q));
});

// ---- permission preset picker ----
const PERM_PRESETS = [
  { id: "read-only", label: "只读", hint: "沙箱只读，禁止写入" },
  { id: "workspace-write", label: "默认（询问）", hint: "工作区可写，超范围询问" },
  { id: "danger-full-access", label: "全权", hint: "完整访问，不询问" },
];
const permSelIdx = ref(0);

function openPermission() {
  mode.value = "permission";
  permSelIdx.value = 0;
}
function pickPermission(id: string) {
  mode.value = "chat";
  busy.value = true;
  const timer = setTimeout(() => (busy.value = false), 15000);
  void setPermission(id).finally(() => { clearTimeout(timer); busy.value = false; });
}

// ---- session picker state ----
const sessionQuery = ref("");
const sessionSelIdx = ref(0);
const filteredSessions = computed(() => {
  const q = sessionQuery.value.trim().toLowerCase();
  const list = q
    ? sessions.filter((s) => s.title.toLowerCase().includes(q) || s.id.includes(q))
    : [...sessions];
  const newEntry = { id: "__new__", title: "＋ 新会话", createdAt: 0, updatedAt: 0, turns: 0 };
  return [...list, newEntry];
});

function toolGlyph(state: Turn["tools"][number]["state"]) {
  return state === "running" ? "⟳" : state === "error" ? "✗" : "✓";
}
function toolColor(state: Turn["tools"][number]["state"]) {
  return state === "running" ? theme.warn : state === "error" ? theme.danger : theme.brand;
}

/** Duration like the web stats bar: "5.4s", "61m38s", "1h05m". */
function fmtDur(ms: number): string {
  const s = ms / 1000;
  if (!Number.isFinite(s) || s < 0) return "0s";
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  if (m < 60) return `${m}m${String(sec).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

/** Token count like the web: "172K", "111M". */
function fmtTok(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}

/** The bottom stats bar, mirroring the deepseek harness web. */
const statsBar = computed(() => {
  const st = session.stats;
  const parts: string[] = [`${st.turns} 轮 · ${st.steps} 步`];
  parts.push(`LLM ${fmtDur(st.llmMs)} · 工具调用 ${fmtDur(st.toolMs)}`);
  if (st.ttftSteps > 0) parts.push(`首 token 平均 ${fmtDur(st.ttftMs / st.ttftSteps)}`);
  if (st.decodeMs > 0 && st.decodeTokens > 0) {
    parts.push(`${Math.round(st.decodeTokens / (st.decodeMs / 1000))} tok/s`);
  }
  const billed = st.inputTokens + st.cacheReadTokens + st.cacheWriteTokens;
  const hit = billed > 0 ? Math.round((st.cacheReadTokens / billed) * 100) : 0;
  parts.push(`缓存命中 ${hit}%`);
  if (billed > 0 || st.outputTokens > 0) {
    parts.push(`输入 ${fmtTok(billed)} tok · 输出 ${fmtTok(st.outputTokens)} tok`);
  }
  return parts.join(" · ");
});

function scrollBottom() {
  const b = scroll.value as unknown as { scrollToBottom?: () => void } | null;
  b?.scrollToBottom?.();
}
function scrollByLines(delta: number) {
  const b = scroll.value as unknown as { scrollByLines?: (n: number) => void } | null;
  b?.scrollByLines?.(delta);
}
function scrollTop() {
  const b = scroll.value as unknown as { scrollToTop?: () => void } | null;
  b?.scrollToTop?.();
}

onMounted(async () => {
  await connect();
  connected.value = true;
});
onUnmounted(() => {
  void disconnect().catch(() => { });
});

function submit() {
  const text = inputText.value.trim();
  if (!text || busy.value) return;
  history.value = [text, ...history.value].slice(0, 50);
  histIdx.value = -1;
  inputText.value = "";
  busy.value = true;
  void nextTick(scrollBottom);
  void prompt(text).finally(() => (busy.value = false));
}

function navHistory(dir: -1 | 1) {
  if (history.value.length === 0) return;
  const next = histIdx.value + dir;
  if (next < -1 || next >= history.value.length) return;
  histIdx.value = next;
  inputText.value = next === -1 ? "" : history.value[next]!;
}

function openModel() {
  mode.value = "model";
  modelQuery.value = "";
  const idx = allModels.value.findIndex((m) => m.model === session.model);
  modelSelIdx.value = idx >= 0 ? idx : 0;
}

// ---- add-model popup (like the web settings-models flow) ----
const MODEL_PROVIDERS = [
  { id: "openai", label: "OpenAI", api: "openai-responses", baseURL: "https://api.openai.com/v1", defaultModel: "" },
  { id: "anthropic", label: "Anthropic Claude", api: "anthropic-messages", baseURL: "https://api.anthropic.com", defaultModel: "" },
  { id: "deepseek", label: "DeepSeek", api: "openai-completions", baseURL: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { id: "gemini", label: "Google Gemini", api: "openai-completions", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "" },
  { id: "openrouter", label: "OpenRouter", api: "openai-completions", baseURL: "https://openrouter.ai/api/v1", defaultModel: "" },
  { id: "moonshot", label: "Moonshot Kimi", api: "openai-completions", baseURL: "https://api.moonshot.cn/v1", defaultModel: "kimi-k2.5" },
  { id: "zhipu", label: "智谱 GLM", api: "openai-completions", baseURL: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-5" },
  { id: "groq", label: "Groq", api: "openai-completions", baseURL: "https://api.groq.com/openai/v1", defaultModel: "" },
  { id: "together", label: "Together AI", api: "openai-completions", baseURL: "https://api.together.xyz/v1", defaultModel: "" },
  { id: "custom", label: "自定义", api: "", baseURL: "", defaultModel: "" },
];

const MODEL_ADD_FIELDS = [
  { key: "provider", label: "提供商名（路由键，如 my-gateway）" },
  { key: "api", label: "API 类型（openai-completions / openai-responses / anthropic-messages / google-generative-ai）" },
  { key: "baseURL", label: "接口地址 baseURL" },
  { key: "apiKeyEnv", label: "密钥环境变量名" },
  { key: "apiKey", label: "API 密钥值" },
  { key: "model", label: "模型 ID" },
  { key: "label", label: "显示名称（可选）" },
] as const;
const MODEL_ADD_MAINSTREAM_FIELDS = [
  { key: "apiKey", label: "API 密钥值（sk-…）" },
  { key: "model", label: "模型 ID（回车用默认）" },
  { key: "label", label: "显示名称（可选）" },
] as const;

const modelAddStep = ref<"pick" | "form" | "models">("pick");
const modelAddProviderIdx = ref(0);
const modelAddIdx = ref(0);
const modelAddValues = ref<Record<string, string>>({});
const modelAddModels = ref<Array<{ id: string; name?: string }> | null>(null);
const modelAddFetching = ref(false);
const modelAddModelIdx = ref(0);
const modelAddPreset = computed(() => {
  const p = MODEL_PROVIDERS[modelAddProviderIdx.value];
  return p && p.id !== "custom" ? p : null;
});
const modelAddFields = computed(() => (modelAddPreset.value ? MODEL_ADD_MAINSTREAM_FIELDS : MODEL_ADD_FIELDS));
const modelAddSummary = computed(() => modelAddFields.value.slice(0, modelAddIdx.value));
const modelAddLabel = computed(() => {
  if (modelAddStep.value === "pick") return "选择提供商";
  if (modelAddStep.value === "models") return "选择模型";
  if (modelAddFetching.value) return "正在获取模型…";
  const fields = modelAddFields.value;
  return fields[Math.min(modelAddIdx.value, fields.length - 1)]!.label;
});

function openModelAdd() {
  mode.value = "modeladd";
  modelAddStep.value = "pick";
  modelAddProviderIdx.value = 0;
  modelAddIdx.value = 0;
  modelAddValues.value = {};
  modelAddModels.value = null;
  modelAddFetching.value = false;
  inputText.value = "";
}
function selectModelAddProvider() {
  const p = MODEL_PROVIDERS[modelAddProviderIdx.value]!;
  modelAddValues.value = {};
  if (p.id !== "custom") {
    modelAddValues.value = {
      provider: `dsh-${p.id}`,
      api: p.api,
      baseURL: p.baseURL,
      apiKeyEnv: `DSH_${p.id.toUpperCase()}_KEY`,
      ...(p.defaultModel ? { model: p.defaultModel } : {}),
    };
  }
  modelAddStep.value = "form";
  modelAddIdx.value = 0;
  inputText.value = "";
}
function nextModelAddField() {
  const field = modelAddFields.value[modelAddIdx.value]!;
  const typed = inputText.value.trim();
  modelAddValues.value[field.key] = typed || modelAddValues.value[field.key] || "";
  if (modelAddIdx.value < modelAddFields.value.length - 1) {
    modelAddIdx.value += 1;
    inputText.value = "";
    const nextKey = modelAddFields.value[modelAddIdx.value]!.key;
    if (nextKey === "model") void startModelFetch();
  } else {
    commitModelAdd();
  }
}
async function startModelFetch() {
  const v = modelAddValues.value;
  if (!v.apiKey || !v.baseURL) return; // no endpoint/key → manual entry
  modelAddFetching.value = true;
  modelAddModels.value = null;
  try {
    const models = await fetchProviderModels({ api: v.api, baseURL: v.baseURL, apiKey: v.apiKey });
    if (models.length > 0) {
      modelAddModels.value = models;
      modelAddStep.value = "models";
      modelAddModelIdx.value = 0;
    }
  } catch {
    /* fall back to manual model entry */
  } finally {
    modelAddFetching.value = false;
  }
}
function pickModelAddModel() {
  const m = modelAddModels.value?.[modelAddModelIdx.value];
  if (m) modelAddValues.value.model = m.id;
  modelAddStep.value = "form";
  modelAddModels.value = null;
  inputText.value = "";
  modelAddIdx.value += 1;
  if (modelAddIdx.value >= modelAddFields.value.length) commitModelAdd();
}
function cancelModelFetch() {
  modelAddStep.value = "form";
  modelAddModels.value = null;
  inputText.value = "";
}
function commitModelAdd() {
  const v = modelAddValues.value;
  const provider = v.provider || "";
  const model = v.model || "";
  mode.value = "chat";
  inputText.value = "";
  if (!provider || !model) return;
  addCustomProvider({
    provider,
    api: v.api || "openai-completions",
    baseURL: v.baseURL || "",
    apiKeyEnv: v.apiKeyEnv || "",
    apiKey: v.apiKey || "",
    model,
    label: v.label || model,
  });
}

function openCommand() {
  mode.value = "command";
  cmdQuery.value = "";
  cmdSelIdx.value = 0;
}

function openSessions() {
  mode.value = "sessions";
  sessionQuery.value = "";
  const activeIdx = sessions.findIndex((s) => s.id === session.id);
  sessionSelIdx.value = activeIdx >= 0 ? activeIdx : 0;
}

function runCommand(id: string) {
  mode.value = "chat";
  cmdQuery.value = "";
  if (id === "new") newSession();
  else if (id === "sessions") openSessions();
  else if (id === "model") openModel();
  else if (id === "modeladd") openModelAdd();
  else if (id === "think") toggleReasoning();
  else if (id === "permission") openPermission();
  else if (id === "rename") openRename();
  else if (id === "clear") clear();
  else if (id === "quit") exit();
}

function openRename() {
  mode.value = "rename";
  inputText.value = session.title;
}

function commitRename() {
  const t = inputText.value.trim();
  if (t) renameSession(t);
  mode.value = "chat";
  inputText.value = "";
}

function pickSession(id: string) {
  mode.value = "chat";
  sessionQuery.value = "";
  if (id === "__new__") newSession();
  else if (id) switchSession(id);
}

function relTime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

async function chooseModel() {
  const m = filteredModels.value[modelSelIdx.value];
  if (!m) return;
  mode.value = "chat";
  modelQuery.value = "";
  const custom = userModels.find((u) => u.model === m.model);
  busy.value = true;
  try {
    await switchModel(m.model, custom?.provider);
  } catch (err) {
    session.error = `切换模型失败：${String(err)}`;
  } finally {
    busy.value = false;
  }
}

useInput((event) => {
  if (mode.value === "modeladd") {
    if (event.type === "key") {
      const name = event.key.name ?? (event.key.ctrl ? event.key.character : undefined);
      if (modelAddStep.value === "pick") {
        if (name === "up") modelAddProviderIdx.value = Math.max(0, modelAddProviderIdx.value - 1);
        else if (name === "down") modelAddProviderIdx.value = Math.min(MODEL_PROVIDERS.length - 1, modelAddProviderIdx.value + 1);
        else if (name === "return" || name === "enter") selectModelAddProvider();
        else if (name === "escape") { mode.value = "chat"; inputText.value = ""; }
        return;
      }
      if (modelAddStep.value === "models") {
        if (name === "up") modelAddModelIdx.value = Math.max(0, modelAddModelIdx.value - 1);
        else if (name === "down") modelAddModelIdx.value = Math.min((modelAddModels.value?.length ?? 1) - 1, modelAddModelIdx.value + 1);
        else if (name === "return" || name === "enter") pickModelAddModel();
        else if (name === "escape") cancelModelFetch();
        return;
      }
      if (modelAddFetching.value) return;
      if (name === "return" || name === "enter") nextModelAddField();
      else if (name === "escape") { mode.value = "chat"; inputText.value = ""; }
      else if (name === "backspace") inputText.value = inputText.value.slice(0, -1);
      else if (name === "space") inputText.value += " ";
    } else if (event.type === "text") {
      if (modelAddStep.value === "pick" || modelAddStep.value === "models" || modelAddFetching.value) return;
      inputText.value += event.text;
    } else if (event.type === "paste") {
      if (modelAddStep.value === "pick" || modelAddStep.value === "models" || modelAddFetching.value) return;
      inputText.value += event.text ?? "";
    }
    return;
  }

  if (mode.value === "permission") {
    if (event.type === "key") {
      const name = event.key.name ?? (event.key.ctrl ? event.key.character : undefined);
      if (name === "up") permSelIdx.value = Math.max(0, permSelIdx.value - 1);
      else if (name === "down") permSelIdx.value = Math.min(PERM_PRESETS.length - 1, permSelIdx.value + 1);
      else if (name === "return" || name === "enter") pickPermission(PERM_PRESETS[permSelIdx.value]!.id);
      else if (name === "escape") mode.value = "chat";
    }
    return;
  }

  if (mode.value === "sessions") {
    if (event.type === "key") {
      const name = event.key.name ?? (event.key.ctrl ? event.key.character : undefined);
      if (name === "up") sessionSelIdx.value = Math.max(0, sessionSelIdx.value - 1);
      else if (name === "down") sessionSelIdx.value = Math.min(filteredSessions.value.length - 1, sessionSelIdx.value + 1);
      else if (name === "return" || name === "enter") pickSession(filteredSessions.value[sessionSelIdx.value]?.id ?? "");
      else if (name === "escape") { mode.value = "chat"; sessionQuery.value = ""; }
      else if (name === "backspace") sessionQuery.value = sessionQuery.value.slice(0, -1);
    } else if (event.type === "text") {
      sessionQuery.value += event.text;
      sessionSelIdx.value = 0;
    }
    return;
  }

  if (mode.value === "rename") {
    if (event.type === "key") {
      const name = event.key.name ?? (event.key.ctrl ? event.key.character : undefined);
      if (name === "return" || name === "enter") commitRename();
      else if (name === "escape") { mode.value = "chat"; inputText.value = ""; }
      else if (name === "backspace") inputText.value = inputText.value.slice(0, -1);
      else if (name === "space") inputText.value += " ";
    } else if (event.type === "text") {
      inputText.value += event.text;
    } else if (event.type === "paste") {
      inputText.value += event.text ?? "";
    }
    return;
  }

  if (mode.value === "model") {
    if (event.type === "key") {
      const name = event.key.name;
      if (name === "up") modelSelIdx.value = Math.max(0, modelSelIdx.value - 1);
      else if (name === "down") modelSelIdx.value = Math.min(filteredModels.value.length - 1, modelSelIdx.value + 1);
      else if (name === "return" || name === "enter") void chooseModel();
      else if (name === "escape") { mode.value = "chat"; modelQuery.value = ""; }
      else if (name === "backspace") modelQuery.value = modelQuery.value.slice(0, -1);
    } else if (event.type === "text") {
      modelQuery.value += event.text;
      modelSelIdx.value = 0;
    }
    return;
  }

  if (mode.value === "command") {
    if (event.type === "key") {
      const name = event.key.name;
      if (name === "up") cmdSelIdx.value = Math.max(0, cmdSelIdx.value - 1);
      else if (name === "down") cmdSelIdx.value = Math.min(filteredCommands.value.length - 1, cmdSelIdx.value + 1);
      else if (name === "return" || name === "enter") runCommand(filteredCommands.value[cmdSelIdx.value]?.id ?? "");
      else if (name === "escape") { mode.value = "chat"; cmdQuery.value = ""; }
      else if (name === "backspace") cmdQuery.value = cmdQuery.value.slice(0, -1);
    } else if (event.type === "text") {
      cmdQuery.value += event.text;
      cmdSelIdx.value = 0;
    }
    return;
  }

  // chat mode
  if (event.type === "key") {
    // Named keys use `key.name`; ctrl+letter uses `key.character`.
    const name = event.key.name ?? (event.key.ctrl ? event.key.character : undefined);
    // Pending permission ask: y/enter allows, n/esc rejects.
    if (session.pendingApproval) {
      if (name === "y" || name === "return" || name === "enter") void respondToApproval(session.pendingApproval.id, "allow");
      else if (name === "n" || name === "escape") void respondToApproval(session.pendingApproval.id, "reject");
      return;
    }
    if (name === "return" || name === "enter") submit();
    else if (name === "up") scrollByLines(-1);
    else if (name === "down") scrollByLines(1);
    else if (name === "left") scrollByLines(-15);
    else if (name === "right") scrollByLines(15);
    else if (name === "p" && event.key.ctrl) navHistory(-1);
    else if (name === "n" && event.key.ctrl) navHistory(1);
    else if (name === "backspace") inputText.value = inputText.value.slice(0, -1);
    else if (name === "space") inputText.value += " ";
    else if (name === "tab") inputText.value += "  ";
    else if (name === "c" && event.key.ctrl) exit();
    else if (name === "x" && event.key.ctrl) openModel();
    else if (name === "k" && event.key.ctrl) openCommand();
    else if (name === "r" && event.key.ctrl) toggleReasoning();
    else if (name === "t" && event.key.ctrl) showToolDetails.value = !showToolDetails.value;
    else if (name === "u" && event.key.ctrl) scrollByLines(-15);
    else if (name === "d" && event.key.ctrl) scrollByLines(15);
    else if (name === "pageup") scrollByLines(-15);
    else if (name === "pagedown") scrollByLines(15);
    else if (name === "home") scrollTop();
    else if (name === "end") scrollBottom();
    else if (name === "escape") {
      const now = Date.now();
      if (now - escAt.value < 400) cancelRun();
      else escAt.value = now;
    }
    return;
  }
  if (event.type === "text") {
    if (session.pendingApproval) {
      if (event.text === "y" || event.text === "Y") void respondToApproval(session.pendingApproval.id, "allow");
      else if (event.text === "n" || event.text === "N") void respondToApproval(session.pendingApproval.id, "reject");
      return;
    }
    if (event.text === "/" && inputText.value === "") { openCommand(); return; }
    inputText.value += event.text;
  }
  if (event.type === "paste") inputText.value += event.text ?? "";
});

function toggleReasoning() {
  showReasoning.value = !showReasoning.value;
}

const statusColor = () =>
  session.error ? theme.danger : session.status === "running" ? theme.warn : connected.value ? theme.brand : theme.header;
const statusLabel = () =>
  session.error ? "错误" : !connected.value ? "连接中…" : session.status === "running" ? "运行中" : "空闲";

function permLabel(): string {
  switch (session.permissionPreset) {
    case "read-only": return "只读";
    case "workspace-write": return "默认";
    case "danger-full-access": return "全权";
    default: return "全权";
  }
}
function permColor(): Color {
  switch (session.permissionPreset) {
    case "read-only": return "#4ade80";
    case "workspace-write": return "#facc15";
    case "danger-full-access": return "#f87171";
    default: return "#f87171";
  }
}


</script>

<template>
  <Box flexDirection="column" :flexGrow="1" :flexBasis="0">

    <!-- Message area -->
    <Box :flexGrow="1" :flexBasis="0" :paddingX="1">
      <!-- Model switcher overlay -->
      <Box v-if="mode === 'model'" flexDirection="column" borderStyle="round" :borderColor="theme.accent" :padding="1">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold :color="theme.accent">切换模型</Text>
          <Text dimColor>{{ session.provider }} 路由</Text>
        </Box>
        <Text :color="theme.border">─</Text>
        <Box v-for="row in modelWindow" :key="row.m.model" flexDirection="row" :gap="1"
          :backgroundColor="row.idx === modelSelIdx ? theme.bgHeader : undefined">
          <Text :color="row.idx === modelSelIdx ? theme.accent : row.m.free ? theme.brand : theme.text2">{{ row.idx ===
            modelSelIdx ? '❯' : ' ' }}</Text>
          <Text :color="row.idx === modelSelIdx ? theme.accent : row.m.free ? theme.brand : theme.text2"
            :bold="row.idx === modelSelIdx">{{ row.m.label }}</Text>
          <Text v-if="row.m.free" :color="theme.brand">free</Text>
          <Text dimColor>{{ row.m.model }}</Text>
        </Box>
        <Text :color="theme.border">─</Text>
        <Box flexDirection="row">
          <Text dimColor italic>↑/↓ 选择 · enter 切换 · 输入筛选 · esc 取消</Text>
        </Box>
      </Box>

      <!-- Session picker overlay -->
      <Box v-else-if="mode === 'sessions'" flexDirection="column" borderStyle="round" :borderColor="theme.brand"
        :padding="1">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold :color="theme.brand">会话</Text>
          <Text dimColor>{{ sessions.length }} 个 · 输入筛选</Text>
        </Box>
        <Text :color="theme.border">─</Text>
        <Box v-for="(s, i) in filteredSessions" :key="s.id" flexDirection="row" :gap="1"
          :backgroundColor="i === sessionSelIdx ? theme.bgHeader : undefined">
          <Text :color="i === sessionSelIdx ? theme.brand : s.id === session.id ? theme.brand : theme.text2">{{ i ===
            sessionSelIdx ? '❯' : s.id === session.id ? '●' : ' ' }}</Text>
          <Text :color="i === sessionSelIdx ? theme.brand : theme.text" :bold="i === sessionSelIdx">{{ s.title }}</Text>
          <Text dimColor v-if="s.id !== '__new__'">{{ s.turns }} 轮 · {{ relTime(s.updatedAt) }}</Text>
        </Box>
        <Text :color="theme.border">─</Text>
        <Box flexDirection="row">
          <Text dimColor italic>↑/↓ 选择 · enter 切换 · esc 取消</Text>
        </Box>
      </Box>

      <!-- Command palette overlay -->
      <Box v-else-if="mode === 'command'" flexDirection="column" borderStyle="round" :borderColor="theme.command"
        :padding="1">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold :color="theme.command">命令</Text>
          <Text dimColor>/ {{ cmdQuery }}</Text>
        </Box>
        <Text :color="theme.border">─</Text>
        <Box v-for="(c, i) in filteredCommands" :key="c.id" flexDirection="row" :gap="1"
          :backgroundColor="i === cmdSelIdx ? theme.bgHeader : undefined">
          <Text :color="i === cmdSelIdx ? theme.command : theme.text2">{{ i === cmdSelIdx ? '❯' : ' ' }}</Text>
          <Text :color="i === cmdSelIdx ? theme.command : theme.text" :bold="i === cmdSelIdx">/{{ c.id }}</Text>
          <Text :color="i === cmdSelIdx ? theme.command : theme.text2">{{ c.label }}</Text>
          <Text dimColor>{{ c.hint }}</Text>
        </Box>
        <Text :color="theme.border">─</Text>
        <Box flexDirection="row">
          <Text dimColor italic>↑/↓ 选择 · enter 执行 · esc 取消</Text>
        </Box>
      </Box>

      <!-- Permission preset picker (before the welcome so a fresh session can switch) -->
      <Box v-else-if="mode === 'permission'" flexDirection="column" borderStyle="round" :borderColor="theme.warn"
        :padding="1">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold :color="theme.warn">权限模式</Text>
          <Text dimColor>↑/↓ 选择 · enter 应用 · esc 取消</Text>
        </Box>
        <Text :color="theme.border">─</Text>
        <Box v-for="(p, i) in PERM_PRESETS" :key="p.id" flexDirection="row" :gap="1"
          :backgroundColor="i === permSelIdx ? theme.bgHeader : undefined">
          <Text :color="i === permSelIdx ? theme.warn : theme.text2">{{ i === permSelIdx ? '❯' : ' ' }}</Text>
          <Text :color="i === permSelIdx ? theme.warn : theme.text" :bold="i === permSelIdx">{{ p.label }}</Text>
          <Text dimColor>{{ p.hint }}</Text>
        </Box>
      </Box>

      <!-- Add-model: provider picker popup -->
      <Box v-else-if="mode === 'modeladd' && modelAddStep === 'pick'" flexDirection="column" borderStyle="round"
        :borderColor="theme.accent" :padding="1">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold :color="theme.accent">配置新模型</Text>
          <Text dimColor>选择提供商 · ↑/↓ · enter · esc 取消</Text>
        </Box>
        <Text :color="theme.border">─</Text>
        <Box v-for="(p, i) in MODEL_PROVIDERS" :key="p.id" flexDirection="row" :gap="1"
          :backgroundColor="i === modelAddProviderIdx ? theme.bgHeader : undefined">
          <Text :color="i === modelAddProviderIdx ? theme.accent : theme.text2">{{ i === modelAddProviderIdx ? '❯' : ' ' }}</Text>
          <Text :color="i === modelAddProviderIdx ? theme.accent : theme.text" :bold="i === modelAddProviderIdx">{{ p.label }}</Text>
          <Text dimColor>{{ p.id === 'custom' ? '完整表单' : p.baseURL }}</Text>
        </Box>
      </Box>

      <!-- Add-model: fetched model list popup -->
      <Box v-else-if="mode === 'modeladd' && modelAddStep === 'models'" flexDirection="column" borderStyle="round"
        :borderColor="theme.accent" :padding="1">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold :color="theme.accent">选择模型</Text>
          <Text dimColor>{{ modelAddModels?.length ?? 0 }} 个 · ↑/↓ · enter · esc 手动输入</Text>
        </Box>
        <Text :color="theme.border">─</Text>
        <Box v-for="(m, i) in modelAddModels ?? []" :key="m.id" flexDirection="row" :gap="1"
          :backgroundColor="i === modelAddModelIdx ? theme.bgHeader : undefined">
          <Text :color="i === modelAddModelIdx ? theme.accent : theme.text2">{{ i === modelAddModelIdx ? '❯' : ' ' }}</Text>
          <Text :color="i === modelAddModelIdx ? theme.accent : theme.text" :bold="i === modelAddModelIdx"
            wrap="truncate">{{ m.name || m.id }}</Text>
          <Text dimColor wrap="truncate">{{ m.id }}</Text>
        </Box>
      </Box>

      <!-- Add-model: form step (input happens inside the popup) -->
      <Box v-else-if="mode === 'modeladd' && modelAddStep === 'form'" flexDirection="column" borderStyle="round"
        :borderColor="theme.accent" :padding="1">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold :color="theme.accent">配置新模型{{ modelAddPreset ? ` — ${modelAddPreset.label}` : ' — 自定义' }}</Text>
          <Text dimColor>enter 下一步 · esc 取消</Text>
        </Box>
        <Text :color="theme.border">─</Text>
        <Box v-for="field in modelAddSummary" :key="field.key" flexDirection="row" :gap="1">
          <Text dimColor :color="theme.text2">{{ field.label }}：</Text>
          <Text dimColor :color="theme.dim" wrap="truncate">{{ modelAddValues[field.key] || '（留空）' }}</Text>
        </Box>
        <Box flexDirection="row" :gap="1">
          <Text :color="theme.accent" bold>{{ modelAddLabel }}：</Text>
          <Text :color="theme.text">{{ inputText }}</Text>
          <Text :color="theme.dim">▏</Text>
        </Box>
        <Box v-if="modelAddFetching" flexDirection="row">
          <Text dimColor :color="theme.dim">正在获取模型…</Text>
        </Box>
      </Box>

      <!-- Welcome (opencode-style home) when no conversation yet -->
      <Box v-else-if="session.turns.length === 0 && !session.current" flexDirection="column" :flexGrow="1"
        justifyContent="center" alignItems="center">
        <Text bold color="cyan">◆ deepseek harness</Text>
        <Text dimColor :color="theme.dim">探索未至之境</Text>
        <Box :height="1" />
        <Text dimColor :color="theme.header" wrap="truncate">当前会话：{{ session.title }}</Text>
        <Box :height="1" />
        <Text dimColor italic :color="theme.muted">输入消息开始对话 · ↑/↓ 滚动 · ←/→ 翻页 · / 命令 · ctrl+x 模型 · esc esc 取消当前</Text>
      </Box>

      <!-- Conversation -->
      <ScrollBox v-else ref="scroll">
        <Box flexDirection="column">
          <!-- Todo list -->
          <Box v-if="session.todos.length" flexDirection="column" :marginY="1">
            <Box v-for="(td, i) in session.todos" :key="i" flexDirection="row">
              <Text
                :color="td.status === 'completed' ? theme.brand : td.status === 'in_progress' ? theme.warn : theme.dim">
                {{ td.status === 'completed' ? '✓' : td.status === 'in_progress' ? '◐' : '○' }}
              </Text>
              <Text :color="td.status === 'completed' ? theme.dim : theme.text2"
                :dimColor="td.status === 'completed'">{{ td.content }}</Text>
            </Box>
          </Box>
          <template v-for="t in session.turns" :key="t.turn">
            <!-- user: left green accent bar + text -->
            <Box v-if="t.user" flexDirection="row" :gap="1" :marginTop="2" :marginBottom="2">
              <Box :backgroundColor="theme.brand" :width="1"></Box>
              <Box flexDirection="column">
                <Box v-for="(r, ui) in t.user.split('\n')" :key="ui" flexDirection="row">
                  <Text :color="theme.text">{{ r }}</Text>
                </Box>
              </Box>
            </Box>
            <!-- reasoning (collapsed by default; ctrl+r toggles all) -->
            <Box v-if="t.reasoning && showReasoning" flexDirection="column" :marginY="1">
              <Box v-for="(r, ri) in t.reasoning.split('\n')" :key="ri" flexDirection="row">
                <Text dimColor italic :color="theme.muted">{{ r }}</Text>
              </Box>
            </Box>
            <Box v-else-if="t.reasoning" flexDirection="row" :marginY="1">
              <Text dimColor italic :color="theme.dim">▸ 思考 ({{ t.reasoning.length }} 字符)</Text>
            </Box>
            <!-- assistant: content then model below -->
            <Box v-if="t.assistant" flexDirection="column">
              <Markdown :text="t.assistant" />
              <Box :marginTop="1">
                <Text dimColor :color="theme.brand">{{ t.model ?? session.model }}</Text>
              </Box>
            </Box>
            <!-- tool calls -->
            <Box v-for="c in t.tools" :key="c.callId" flexDirection="column">
              <Box flexDirection="row" :gap="1">
                <Text :color="toolColor(c.state)">{{ toolGlyph(c.state) }}</Text>
                <Text :color="c.state === 'error' ? theme.danger : theme.text2">{{ c.name }}</Text>
              </Box>
              <template v-if="showToolDetails">
                <Box v-if="c.arguments" flexDirection="column" :paddingX="2">
                  <Text dimColor :color="theme.dim" wrap="truncate">{{ fmtArgs(c.arguments) }}</Text>
                </Box>
                <Box v-if="c.result" flexDirection="column" :paddingX="2">
                  <Text dimColor :color="theme.dim" wrap="truncate">{{ c.result }}</Text>
                </Box>
              </template>
              <Box v-else-if="c.result" flexDirection="row" :paddingX="2">
                <Text dimColor :color="theme.dim">{{ c.result.slice(0, 200) }}{{ c.result.length > 200 ? '…' : ''
                  }}</Text>
              </Box>
            </Box>
            <Box v-if="t.endError" flexDirection="row" :paddingX="1">
              <Text :color="theme.danger">✗ {{ t.endError }}</Text>
            </Box>
            <Box v-else-if="t.endReason === 'aborted'" flexDirection="row" :paddingX="1">
              <Text dimColor italic :color="theme.warn">■ 已中止</Text>
            </Box>
            <Box :height="1" />
          </template>

          <!-- Live stream while a turn is running -->
          <Box v-if="session.current" flexDirection="column">
            <Box v-if="session.current.user" flexDirection="row" :gap="1" :marginTop="2" :marginBottom="2">
              <Box :backgroundColor="theme.brand" :width="1"></Box>
              <Box flexDirection="column">
                <Box v-for="(r, ui) in session.current.user.split('\n')" :key="ui" flexDirection="row">
                  <Text :color="theme.text">{{ r }}</Text>
                </Box>
              </Box>
            </Box>
            <Box v-if="session.current.retry" flexDirection="row" :paddingX="1">
              <Text :color="theme.warn">⟳ {{ session.current.retry }}</Text>
            </Box>
            <Box v-if="session.current.reasoning" flexDirection="column">
              <Box v-for="(r, ri) in session.current.reasoning.split('\n')" :key="ri" flexDirection="row">
                <Text dimColor italic :color="theme.muted">{{ r }}</Text>
              </Box>
            </Box>
            <Box v-if="session.current.assistant" flexDirection="column">
              <Markdown :text="session.current.assistant" />
              <Box :marginTop="1">
                <Text dimColor :color="theme.brand">{{ session.current.model ?? session.model }}</Text>
              </Box>
            </Box>
            <Box v-for="c in session.current.tools" :key="c.callId" flexDirection="column">
              <Box flexDirection="row" :gap="1">
                <Text :color="toolColor(c.state)">{{ toolGlyph(c.state) }}</Text>
                <Text :color="c.state === 'error' ? theme.danger : theme.text2">{{ c.name }}</Text>
              </Box>
              <template v-if="showToolDetails && c.arguments">
                <Box flexDirection="column" :paddingX="2">
                  <Text dimColor :color="theme.dim" wrap="truncate">{{ fmtArgs(c.arguments) }}</Text>
                </Box>
              </template>
            </Box>
          </Box>

          <Box v-if="session.error" flexDirection="row">
            <Text :color="theme.danger">✗ {{ session.error }}</Text>
          </Box>
        </Box>
      </ScrollBox>
    </Box>

    <!-- Approval banner (pending permission ask) -->
    <Box v-if="session.pendingApproval" flexDirection="column" borderStyle="round" :borderColor="theme.warn"
      :marginX="1" :paddingX="1">
      <Box flexDirection="row" :gap="1">
        <Text bold :color="theme.warn">⚠ 需要授权</Text>
        <Text :color="theme.text2">{{ session.pendingApproval.toolName }}</Text>
      </Box>
      <Box v-if="session.pendingApproval.reason" flexDirection="row">
        <Text dimColor :color="theme.dim">{{ session.pendingApproval.reason }}</Text>
      </Box>
      <Box flexDirection="row">
        <Text dimColor italic :color="theme.muted">按 y / 回车 允许 · n / esc 拒绝</Text>
      </Box>
    </Box>

    <!-- Bottom: composer (input + model inside the box), then stats toolbar -->
    <Box flexDirection="column" borderStyle="round" :borderColor="theme.border" :marginX="1" :paddingX="1">
      <Box flexDirection="row">
        <Text v-if="mode === 'modeladd'" bold :color="theme.accent">＋ </Text>
        <Text v-else-if="mode === 'rename'" bold :color="theme.command">✎ </Text>
        <Text v-else-if="busy" :color="theme.warn">⟳ </Text>
        <Text v-else bold :color="theme.brand">❯ </Text>
        <Text :color="theme.text" wrap="truncate">{{ mode === 'modeladd' ? '' : inputText }}</Text>
        <Text v-if="mode === 'modeladd'" dimColor>配置新模型（在弹窗中填写）</Text>
        <Text v-else-if="mode === 'rename' && inputText === ''" dimColor>重命名会话为…</Text>
        <Text v-else-if="inputText === ''" dimColor>输入消息…</Text>
        <Text :color="theme.dim">▏</Text>
      </Box>
      <Box flexDirection="row" :gap="1">
        <Text dimColor :color="permColor()">{{ permLabel() }}</Text>
        <Text dimColor :color="theme.muted">·</Text>
        <Text dimColor :color="theme.accent">{{ session.model }}</Text>
        <Text dimColor :color="theme.muted">{{ session.provider }}</Text>
      </Box>
    </Box>

    <Box flexDirection="row" :paddingX="1">
      <Text dimColor :color="theme.dim" wrap="truncate">{{ statsBar }}</Text>
    </Box>
  </Box>
</template>
