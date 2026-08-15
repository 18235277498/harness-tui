/**
 * Headless layout smoke test: render the same Box/Text/ScrollBox/Spinner props
 * used by app.vue and assert they render without a VueTUI closed-prop error.
 * Catches runtime prop bugs (like the earlier `<Box height="1">`) without a TTY.
 */
import { defineComponent, h, ref } from "vue";
import { test, expect } from "vitest";
import { render } from "@vue-tui/testing";
import { Box, Text } from "@vue-tui/runtime";
import { ScrollBox, Spinner } from "@vue-tui/components";

const Layout = defineComponent(() => {
  const calls = ref([
    { callId: "a", name: "read", state: "done" },
    { callId: "b", name: "bash", state: "running" },
  ]);
  const toolLine = (c: { callId: string; name: string; state: string }) =>
    h(Box, { flexDirection: "row" }, [
      h(Text, { color: c.state === "done" ? "#4ade80" : "#facc15" }, c.state === "done" ? "✓" : "⟳"),
      h(Text, { color: "#cbd5e1" }, ` ${c.name}`),
    ]);
  return () =>
    h(Box, { flexDirection: "column", flexGrow: 1, flexBasis: 0, borderStyle: "round", borderColor: "cyan" }, [
      h(
        Box,
        { justifyContent: "space-between" },
        [
          h(Box, { flexDirection: "row" }, [h(Text, { bold: true, color: "cyan" }, "◆ harness")]),
          h(Text, { color: "#7dd3fc" }, "deepseek-v4-flash"),
        ],
      ),
      h(ScrollBox, { ref: "scroll" }, [
        h(Box, { flexDirection: "column", paddingX: 1 }, calls.value.map(toolLine)),
      ]),
      h(
        Box,
        { flexDirection: "row", justifyContent: "space-between", paddingX: 1 },
        [
          h(Text, { dimColor: true, italic: true }, "Enter send · ↑/↓ history"),
          h(Spinner, { type: "line", color: "#facc15" }),
        ],
      ),
    ]);
});

test("OpenCode-style layout renders without closed-prop errors", async () => {
  const result = await render(Layout, { mode: "fullscreen", columns: 100, rows: 30 });
  const frame = result.lastFrame();
  expect(frame, "frame should contain no VueTUI error text").not.toMatch(/Render Error|must be a/i);
  expect(frame).toContain("harness");
  expect(frame).toContain("deepseek-v4-flash");
  expect(frame).toContain("read");
  expect(frame).toContain("bash");
  result.dispose();
});
