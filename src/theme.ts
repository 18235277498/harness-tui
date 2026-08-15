import { Color } from "@vue-tui/runtime";

/**
 * The single hardcoded theme. Swap these values to re-skin the whole TUI;
 * every accent in app.vue reads from here.
 */
export const theme: { [any: string]: Color } = {
  /** Brand green: user-message accent bar, model labels, idle state. */
  brand: "#4ade80",
  /** Sky accent: model name in header/composer, links, selections. */
  accent: "#7dd3fc",
  /** Amber: running/busy states. */
  warn: "#facc15",
  /** Red: errors. */
  danger: "#f87171",
  /** Header + turn bar background. */
  bgHeader: "#1e293b",
  /** Selection row background. */
  bgSel: "#1e293b",
  /** Primary body text. */
  text: "#e2e8f0",
  /** Secondary text (tool names, list items). */
  text2: "#cbd5e1",
  /** Header / turn-number text. */
  header: "#94a3b8",
  /** Command palette accent. */
  command: "#38bdf8",
  /** Secondary text (dim). */
  dim: "#64748b",
  /** Muted text (hints). */
  muted: "#475569",
  /** Separators / borders. */
  border: "#334155",
  /** Code block background. */
  codeBg: "#0f172a",
  /** Inline code color. */
  inlineCode: "#fbbf24",
  /** Tool icons / glyphs. */
  toolDone: "#4ade80",
  toolRun: "#facc15",
  toolErr: "#f87171",
};
