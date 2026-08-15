/**
 * Markdown renderer smoke test: render a representative markdown sample through
 * src/Markdown.vue and assert the output is non-trivial and free of the
 * VueTUI closed-prop "Render Error" / "must be a" failures.
 */
import { test, expect } from "vitest";
import { render } from "@vue-tui/testing";
import Markdown from "../src/Markdown.vue";

const sample = [
  "# Big Title",
  "",
  "Some **bold** and `inline` code and normal text.",
  "",
  "```js",
  "function hi(name) {",
  "  return `hello ${name}`",
  "}",
  "```",
  "",
  "- item one",
  "- item two",
  "",
  "> a quote line",
].join("\n");

test("Markdown renders headings, code, lists without prop errors", async () => {
  const result = await render(Markdown, { props: { text: sample }, columns: 90, rows: 60 });
  const frame = result.lastFrame();
  expect(frame, "no render-error overlay").not.toMatch(/Render Error|must be a/i);
  expect(frame).toContain("Big Title");
  expect(frame).toContain("function hi");
  expect(frame).toContain("item one");
  expect(frame).toContain("quote line");
  // Bold must be consumed by the renderer, not shown literally as **markers**.
  expect(frame, "literal ** markers must be gone after marked parse").not.toContain("**bold**");
  expect(frame).toContain("bold");
  result.dispose();
});
