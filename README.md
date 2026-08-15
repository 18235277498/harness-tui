# harness-tui

A **VueTUI terminal panel inspired by OpenCode** that drives a real DeepSeek
Harness `jsonrpc-agent` subprocess over stdio JSON-RPC. Fullscreen dark theme,
Chinese UI, session persistence + resume, model switching, permission modes,
custom-model configuration, and a live stats toolbar (turns/steps/LLM time/
tool time/ttft/tok-s/cache-hit/tokens).

```
harness-tui (VueTUI, Node process)
  └─ src/harness.ts  → @deepseek-ai/dsh-sdk-client (DeepSeekHarness)
        └─ spawns  node --import tsx/esm
              packages/examples/jsonrpc-demo/src/bin.ts  opencode-sandbox.cordis.yml
                 (the dsh-jsonrpc-agent runtime, sourced from the sibling checkout)
                     └─ real model turn → session.event / session.status frames
```

## Features

- **Fullscreen TUI** (opencode-style): status bar, centered welcome home,
  message stream (user messages with a green accent bar, collapsible thinking),
  bordered composer showing the active model, and a bottom stats toolbar.
- **Multi-session**: sessions persist as JSONL under the configured root; start
  fresh each launch, switch via `/sessions`, rename via `/rename`.
- **Cross-process resume**: switching to an older persisted session resumes its
  history and continues it (via the SDK-server resume seed patch —
  `npm run patch:kernel` re-applies it after upstream updates).
- **Model switching**: `ctrl+x` or `/model` opens the picker; `/modeladd`
  configures a custom provider/model (writes the `llm-pi-ai` section of
  `<home>/settings.yaml`, hot-published by the runtime).
- **Permission modes** (`/permission`): read-only / default(ask) / full access.
  The default preset is `danger-full-access` (current unattended behavior);
  switching engages the sandbox (Windows ACL restricted-token) and approval
  asks (`y/enter` allow, `n/esc` reject).
- **Stats toolbar**: turns/steps, LLM + tool wall time, avg first-token,
  tokens/sec, cache-hit %, input/output tokens.
- **Keys**: `↑/↓` scroll, `←/→` page, `PgUp/PgDn`, `Home/End`, `Ctrl+U/D` scroll;
  `Ctrl+P/N` input history; `Ctrl+R` thinking; `Ctrl+T` tool details; `/` commands;
  `Ctrl+X` model; `Ctrl+C` quit.

## Run

```bash
npm install
npm run build            # -> dist/main.mjs
# from a real terminal:
node dist/main.mjs
# DSH_CONFIG=/path/to/other.cordis.yml node dist/main.mjs   # alternate config
```

Keys: `/` commands · `Ctrl+X` model · `↑/↓` scroll · `Enter` send.

Headless layout validation (works without a TTY):

```bash
npm run test
```

## Global install (test from any directory)

`dist/main.mjs` is a self-contained bundle (all third-party deps inlined), so
the app can be installed globally and launched from anywhere:

```bash
npm run build
npm install -g .          # installs the `dsh-tui` command
# from any directory, in a real terminal:
dsh-tui
```

Runtime discovery (from the global install, the package is a symlink back to
this checkout, resolved via `realpath`):

- `DSH_REPO` — deepseek-harness source checkout. Optional when this repo stays
  at `../deepseek-harness` relative to the checkout; set it if you move either
  directory.
- `DSH_CONFIG` — override the default `opencode-sandbox.cordis.yml` (picked up
  from the package root).

## Kernel patches

The SDK JSON-RPC server needs a small resume fix (seed persisted history into
`agents.create`) for cross-process session continuation. After updating the
sibling `deepseek-harness` checkout, re-apply it:

```bash
npm run patch:kernel      # idempotent; rebuilds host libs
```
