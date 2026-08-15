/**
 * Model directory for the TUI. The `opencode` provider route (OpenCode Zen,
 * mounted by `llm-pi-ai` in `opencode-free.cordis.yml`) serves this whole
 * catalog; switching models is just re-initializing the runtime with a
 * different `model` id. `*-free` entries cost 0.
 *
 * Source of truth: the pi-ai installed catalog
 * (`@earendil-works/pi-ai/dist/providers/data/opencode.json`), flattened here
 * so the TUI needs no network/model-listing RPC (the SDK protocol has none).
 */

export interface ModelEntry {
  /** Model id accepted by the `opencode` provider route. */
  model: string;
  /** Human-readable name. */
  label: string;
  /** Wire protocol family (display-only grouping). */
  group: string;
  /** Whether this model is a zero-cost `*-free` entry. */
  free: boolean;
}

export const MODEL_CATALOG: ModelEntry[] = [
  // --- DeepSeek (free first) ---
  { model: "deepseek-v4-flash-free", label: "DeepSeek V4 Flash Free", group: "openai-completions", free: true },
  { model: "deepseek-v4-flash", label: "DeepSeek V4 Flash", group: "openai-completions", free: false },
  { model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", group: "openai-completions", free: false },

  // --- Claude ---
  { model: "claude-opus-4-8", label: "Claude Opus 4.8", group: "anthropic-messages", free: false },
  { model: "claude-opus-5", label: "Claude Opus 5", group: "anthropic-messages", free: false },
  { model: "claude-opus-4-7", label: "Claude Opus 4.7", group: "anthropic-messages", free: false },
  { model: "claude-opus-4-6", label: "Claude Opus 4.6", group: "anthropic-messages", free: false },
  { model: "claude-opus-4-5", label: "Claude Opus 4.5", group: "anthropic-messages", free: false },
  { model: "claude-opus-4-1", label: "Claude Opus 4.1", group: "anthropic-messages", free: false },
  { model: "claude-sonnet-5", label: "Claude Sonnet 5", group: "anthropic-messages", free: false },
  { model: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", group: "anthropic-messages", free: false },
  { model: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", group: "anthropic-messages", free: false },
  { model: "claude-sonnet-4", label: "Claude Sonnet 4", group: "anthropic-messages", free: false },
  { model: "claude-haiku-4-5", label: "Claude Haiku 4.5", group: "anthropic-messages", free: false },
  { model: "claude-fable-5", label: "Claude Fable 5", group: "anthropic-messages", free: false },

  // --- GPT ---
  { model: "gpt-5.6-sol", label: "GPT-5.6 Sol", group: "openai-responses", free: false },
  { model: "gpt-5.6-luna", label: "GPT-5.6 Luna", group: "openai-responses", free: false },
  { model: "gpt-5.6-terra", label: "GPT-5.6 Terra", group: "openai-responses", free: false },
  { model: "gpt-5.5-pro", label: "GPT-5.5 Pro", group: "openai-responses", free: false },
  { model: "gpt-5.5", label: "GPT-5.5", group: "openai-responses", free: false },
  { model: "gpt-5.4-pro", label: "GPT-5.4 Pro", group: "openai-responses", free: false },
  { model: "gpt-5.4", label: "GPT-5.4", group: "openai-responses", free: false },
  { model: "gpt-5.4-mini", label: "GPT-5.4 Mini", group: "openai-responses", free: false },
  { model: "gpt-5.4-nano", label: "GPT-5.4 Nano", group: "openai-responses", free: false },
  { model: "gpt-5.3-codex", label: "GPT-5.3 Codex", group: "openai-responses", free: false },
  { model: "gpt-5.2-codex", label: "GPT-5.2 Codex", group: "openai-responses", free: false },
  { model: "gpt-5.2", label: "GPT-5.2", group: "openai-responses", free: false },
  { model: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", group: "openai-responses", free: false },
  { model: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", group: "openai-responses", free: false },
  { model: "gpt-5.1-codex", label: "GPT-5.1 Codex", group: "openai-responses", free: false },
  { model: "gpt-5.1", label: "GPT-5.1", group: "openai-responses", free: false },
  { model: "gpt-5-codex", label: "GPT-5 Codex", group: "openai-responses", free: false },
  { model: "gpt-5-nano", label: "GPT-5 Nano", group: "openai-responses", free: false },
  { model: "gpt-5", label: "GPT-5", group: "openai-responses", free: false },

  // --- Gemini ---
  { model: "gemini-3.6-flash", label: "Gemini 3.6 Flash", group: "google-generative-ai", free: false },
  { model: "gemini-3.5-flash", label: "Gemini 3.5 Flash", group: "google-generative-ai", free: false },
  { model: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", group: "google-generative-ai", free: false },
  { model: "gemini-3.1-pro", label: "Gemini 3.1 Pro Preview", group: "google-generative-ai", free: false },
  { model: "gemini-3-flash", label: "Gemini 3 Flash", group: "google-generative-ai", free: false },

  // --- Grok ---
  { model: "grok-4.5", label: "Grok 4.5", group: "openai-responses", free: false },
  { model: "grok-build-0.1", label: "Grok Build 0.1", group: "openai-completions", free: false },

  // --- Qwen ---
  { model: "qwen3.6-plus", label: "Qwen3.6 Plus", group: "anthropic-messages", free: false },
  { model: "qwen3.5-plus", label: "Qwen3.5 Plus", group: "anthropic-messages", free: false },

  // --- GLM ---
  { model: "glm-5.2", label: "GLM-5.2", group: "openai-completions", free: false },
  { model: "glm-5.1", label: "GLM-5.1", group: "openai-completions", free: false },
  { model: "glm-5", label: "GLM-5", group: "openai-completions", free: false },

  // --- Kimi ---
  { model: "kimi-k2.7-code", label: "Kimi K2.7 Code", group: "openai-completions", free: false },
  { model: "kimi-k2.6", label: "Kimi K2.6", group: "openai-completions", free: false },
  { model: "kimi-k2.5", label: "Kimi K2.5", group: "openai-completions", free: false },

  // --- MiniMax ---
  { model: "minimax-m3", label: "MiniMax-M3", group: "openai-completions", free: false },
  { model: "minimax-m2.7", label: "MiniMax-M2.7", group: "openai-completions", free: false },
  { model: "minimax-m2.5", label: "MiniMax-M2.5", group: "openai-completions", free: false },

  // --- Other free ---
  { model: "mimo-v2.5-free", label: "MiMo V2.5 Free", group: "openai-completions", free: true },
  { model: "laguna-s-2.1-free", label: "Laguna S 2.1 Free", group: "openai-completions", free: true },
  { model: "ling-3.0-flash-free", label: "Ling-3.0-flash Free", group: "openai-completions", free: true },
  { model: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra Free", group: "openai-completions", free: true },
  { model: "north-mini-code-free", label: "North Mini Code Free", group: "openai-completions", free: true },

  // --- Other ---
  { model: "big-pickle", label: "Big Pickle", group: "openai-completions", free: false },
];

export const DEFAULT_MODEL = "deepseek-v4-flash-free";
export const DEFAULT_PROVIDER = "opencode";

export function modelEntry(id: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.model === id);
}
