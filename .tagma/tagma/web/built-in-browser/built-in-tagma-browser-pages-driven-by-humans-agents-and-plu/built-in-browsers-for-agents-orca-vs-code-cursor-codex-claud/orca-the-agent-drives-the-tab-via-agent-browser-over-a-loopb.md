---
id: 01a14742-3850-72e4-936c-231a1ff1496a
title: "Orca: the agent drives the tab via agent-browser over a loopback CDP proxy on webContents.debugger"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Orca 0df25b7 — agent-browser-bridge-*, cdp-*, grab-*, CLI browser handlers",
      "ref": ".external/orca/src"
    }
  }
---
Paths are relative to `.external/orca/src/`. The `agent-browser` source is not in the checkout (`node_modules` missing): its behavior is inferred from Orca's code.

**Chain.** The agent calls the `orca` CLI (`goto`, `snapshot`, `click --element @e3`, `fill`, `type`, `keypress`, `screenshot`, `pdf`, `eval`, `wait`, `tab list/create/switch/close`, `console`, `network`, `cookie`, `exec` — straight pass-through into `agent-browser`) → RPC `browser.*` into runtime → `AgentBrowserBridge` in main Electron → one separate process per command, `agent-browser --session orca-tab-<pageId> --cdp <port> … --json` (`main/browser/agent-browser-bridge-execution.ts:89-101`, `agent-browser-bridge-raw-process.ts:27-40`). `agent-browser` (npm `~0.27.0`, Vercel Labs Rust CLI) forks a daemon per session; the daemon speaks CDP with a loopback proxy.

**CDP proxy** (`main/browser/cdp-ws-proxy.ts`): HTTP + WebSocket on `127.0.0.1:0` for one tab; attaches `webContents.debugger` and forwards commands. It answers as Target/Browser itself, names itself `Chrome/<version>` in `/json/version` so as not to betray the proxy. It intercepts what is broken in webview: `Page.captureScreenshot` hangs, `Page.printToPDF` is missing (goes through `webContents.printToPDF`), `Input.insertText` needs native focus, `Page.navigate`/`reload` without `Network.enable` give no network idle, and CDP subscriptions vanish after a process swap. Protection is only `Origin` and `Host` headers, no token.

**Addressing and refs.** A page is the `browserPageId` from `tab list`; without one, the worktree's active tab. `snapshot` returns an accessibility tree with `@eN` refs; refs live within one tab until navigation. A stale ref is recognized by matching the helper's error text with a regexp. Refusal codes and recovery are described to the agent in `skill-guides/orca-cli/references/browser.md`.

**What moved out of the subprocess.** A process per event proved slow: about 160 ms per keypress, plus wrong key codes (commit `a28cd9eae5`). Now mouse by coordinates, keys via the US table, goto, reload, pdf, screenshots, evaluate, and viewport go straight to main via CDP/webContents. The helper keeps snapshot and everything by ref.

**Pitfalls.** One debugger per webContents: with DevTools open attach fails, and opening DevTools detaches the debugger. Plain tabs never attach a debugger: "Cloudflare treats CDP as a bot signal". Screenshots need a painted guest (paint hold; used to hang on a minimized window). Background throttling off. Emulation on a crashed guest crashes main. Daemons stay orphaned after a crash — swept at startup. Console/network buffers live in the daemon and die after 10 idle minutes.

**Dead code.** Their own CDP engine (`CdpBridge`, snapshot engine, ~13 files, about 2.7k lines) is never constructed in production: Orca wrote its own and moved to `agent-browser` (conclusion: for breadth of commands).

**User element picking.** A hotkey enables an overlay in the guest (`executeJavaScript`), the click resolves inside the page, main validates the payload as untrusted: URL, selector, path, HTML ≤4 KB, attributes from an allowlist with secret redaction, accessible role and name, 16 computed styles, PNG ≤2 MB. Annotations (comment, intent) reach the agent as markdown text with `browserPageId`. The agent never invokes picking itself.

**Size.** The `agent-browser` bridge is 3.3k lines; CDP and snapshot 4.6k (2.7k dead); runtime commands 2.6k; CLI 1k; element picking 1.7k + annotations in renderer 4.8k.

**Electron dependence.** Everything runs where `webContents` exists — in main Electron. The proxy itself is a plain loopback WebSocket, so a CDP client needs no Electron.
