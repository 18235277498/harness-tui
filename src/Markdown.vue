<script lang="ts">
/**
 * Markdown renderer for VueTUI: parse with `marked`, then render the AST as
 * VueTUI <Box>/<Text> style nodes (no ANSI). Headings, bold, italic, inline
 * code, code blocks with highlight.js line highlighting, lists, blockquote, hr.
 *
 * The component is a render-function component (no <template>) so it can emit
 * VNodes directly; using h() avoids the closed-prop runtime errors of template
 * passthrough. Wrapped by the caller inside the message stream.
 */
import { defineComponent, h, type PropType } from "vue";
import { marked, type Tokens } from "marked";
import hljs from "highlight.js";
import { Box, Text } from "@vue-tui/runtime";
import { theme } from "./theme";

const CODE = theme.text; // body text
const CODE_BG = theme.codeBg; // code block text color
const MUTED = theme.dim;
const HEADING_COLORS = [theme.accent, theme.command, "#22d3ee", theme.brand, "#22c55e", "#a3e635"];

type Frag = { text: string; color?: string; bold?: boolean; italic?: boolean; dim?: boolean };

function inlineFrags(tokens: Tokens[] | undefined | null): Frag[] {
  const out: Frag[] = [];
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case "text":
        out.push({ text: (tok as Tokens.Text).text ?? "", color: CODE });
        break;
      case "strong": {
        const prev = inlineFrags((tok as any).tokens);
        for (const f of prev) out.push({ ...f, bold: true });
        break;
      }
      case "em": {
        const prev = inlineFrags((tok as any).tokens);
        for (const f of prev) out.push({ ...f, italic: true });
        break;
      }
      case "codespan":
        out.push({ text: (tok as any).text ?? "", color: theme.inlineCode });
        break;
      case "link":
        out.push({ text: String((tok as any).text ?? (tok as any).href ?? ""), color: theme.accent });
        break;
      case "del":
        out.push({ text: (tok as any).text ?? "", color: MUTED, dim: true });
        break;
      default:
        out.push({ text: String((tok as any).text ?? ""), color: CODE });
    }
  }
  if (out.length === 0) out.push({ text: "", color: CODE });
  return out;
}

function row(frags: Frag[], opts: { bg?: boolean; pad?: boolean } = {}): any {
  return h(
    Box,
    { flexDirection: "row", backgroundColor: opts.bg ? theme.bgHeader : undefined },
    (opts.pad ? [{ text: "  ", color: CODE }] : []).concat(frags).map((f, i) =>
      h(
        Text,
        { key: i, color: f.color ?? CODE, bold: f.bold ?? false, italic: f.italic ?? false, dimColor: f.dim ?? false },
        f.text,
      ),
    ),
  );
}

function blank(): any {
  return h(Box, { height: 1 }, []);
}

export default defineComponent({
  name: "Markdown",
  props: { text: { type: String as PropType<string>, default: "" } },
  setup(props) {
    return () => {
      const lexer = new marked.Lexer({});
      const tokens = lexer.lex(props.text);
      const rows = [] as any;

      for (const tok of tokens) {
        switch (tok.type) {
          case "heading": {
            const color = HEADING_COLORS[(tok as Tokens.Heading).depth - 1] ?? theme.accent;
            rows.push(row(inlineFrags((tok as Tokens.Heading).tokens).map((f) => ({ ...f, color, bold: true }))));
            break;
          }
          case "code": {
            const lang = (tok as Tokens.Code).lang ?? "";
            const text = (tok as Tokens.Code).text.replace(/\n$/, "");
            const lines = text.split("\n");
            if (lang) rows.push(row([{ text: ` ${lang} `, color: theme.dim, italic: true }], { bg: true }));
            for (const ln of lines) rows.push(row([{ text: ln.length ? ln : " ", color: CODE_BG }], { bg: true, pad: true }));
            rows.push(blank());
            break;
          }
          case "paragraph":
            rows.push(row(inlineFrags((tok as Tokens.Paragraph).tokens)));
            rows.push(blank());
            break;
          case "list": {
            const list = tok as Tokens.List;
            (list.items ?? []).forEach((item: Tokens.ListItem, idx: number) => {
              const marker = list.ordered ? `${idx + 1}.` : "•";
              rows.push(
                row([{ text: ` ${marker} `, color: theme.header }].concat(inlineFrags(item.tokens as Tokens[]))),
              );
            });
            rows.push(blank());
            break;
          }
          case "blockquote":
            rows.push(
              row([{ text: "│ ", color: MUTED, dim: true }].concat(inlineFrags((tok as Tokens.Blockquote).tokens as Tokens[]))),
            );
            rows.push(blank());
            break;
          case "space":
            break;
          case "hr":
            rows.push(row([{ text: "· · ·", color: MUTED, dim: true }]));
            rows.push(blank());
            break;
          default:
            rows.push(row([{ text: String((tok as any).text ?? ""), color: CODE }]));
        }
      }
      return h(Box, { flexDirection: "column" }, rows);
    };
  },
});
</script>
