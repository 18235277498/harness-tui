#!/usr/bin/env node
import { createApp } from "@vue-tui/runtime";
import App from "./app.vue";

// A stray async rejection must never kill the TUI silently (Node exits on
// unhandled rejections by default). Log to stderr, which the renderer doesn't own.
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[harness-tui] unhandled rejection: ${String(reason)}\n`);
});

const app = createApp(App);
app.mount({ exitOnCtrlC: true, mode: "fullscreen" });
await app.waitUntilExit();
process.exit(0);
