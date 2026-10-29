---
id: 01a14742-3850-72e4-936c-231db8c9e955
title: Built-in browsers of VS Code, Cursor, Codex, Claude Code, and others, Electron 43–44.8, and CDP automation engines
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Docs and changelogs of VS Code, Cursor, Codex, Claude Code, Antigravity, Kiro; Electron 43.0–44.8 release notes",
      "ref": "https://releases.electronjs.org/release/v44.8.0"
    }
  }
---
Collected from docs, changelogs, and reviews. Only VS Code described its own browser architecture (below); other vendors stay with vague words.

**Products.**
- **VS Code** — browser tools in Copilot GA 2026-07-01, built in, no MCP: `openBrowserPage`, `navigatePage`, `readPage`, `screenshotPage`, `clickElement`, `hoverElement`, `dragElement`, `typeInPage`, `handleDialog`, `runPlaywrightCode`. Agent sessions private, in memory; the agent gets the user's tab only via "Share with Agent"; "Add to Chat" attaches the element's HTML/CSS/screenshot and console logs ([docs](https://github.com/microsoft/vscode-docs/blob/main/docs/agents/run/browser-tools.md)). Closest to Tagma's goal.
  Architecture — per the repo description ([`.github/skills/integrated-browser/SKILL.md`](https://github.com/microsoft/vscode/blob/main/.github/skills/integrated-browser/SKILL.md), read 2026-10-17 via a retelling fetch; not verified against VS Code sources, document date invisible): "A page is a native `WebContentsView` that only the main process may create, own, and position"; when overlapped, workbench "hides the native view, swapping in a placeholder", and "while hidden/repositioning, a periodic screenshot stands in"; "CDP is proxied, never raw" — a protocol proxy in main implements the browser and target level domains, and Playwright attaches to it; the Electron session id serves as the CDP browser-context id; a preload in each page's isolated world decides which presses the page keeps and which go to VS Code chords.
- **Claude Code desktop** — Browser panel since July 2026: clean profile with no saved logins, checked actions; 2026-10-15 — domain policy and permission for dev servers.
- **Codex desktop** — built-in browser since April 2026: separate profile, annotation mode (click or area + comment), since June — CDP in Developer mode with explicit permission. Not in CLI or IDE extension.
- **Cursor** — since 2.0 (2025-10-29): "secure web view, driven by an MCP server in the extension"; navigation, clicks, input, screenshots, console/network; element picking into chat, Visual Editor since 2.2. Engine undisclosed.
- **Antigravity** — drives the user's external Chrome via Chrome DevTools MCP in a separate profile, writes sessions to WebM; not an embedded view.
- **Kiro** (Browser panel + Annotate), **Conductor** (localhost preview with no agent driving), **Superset** (CLI + raw CDP WebSocket, Design Mode). Zed and Warp have no built-in browser.

**Electron 43–44.8.** 44.8.0 shipped 2026-10-16 (Chromium 152, Node 24.22); 45.0.0 planned for 2026-10-20. No breaking changes for `<webview>`, `WebContentsView`, offscreen, or `webContents.debugger` in 43–44; in 44.0 `clipboard` was removed from renderer. `<webview>` docs "do not recommend" it and give no guarantees, but do not mark it deprecated; `BrowserView` deprecated since 29, replaced by `WebContentsView`. `WebContentsView` lives in main, positioned with `setBounds`, layer order is `addChildView` order; window HTML never paints over it. `webContents.debugger` is main-only; opening DevTools detaches it. `--remote-debugging-port` opens CDP to the whole app. Playwright `_electron` is experimental; webview historically invisible in Puppeteer and Playwright `browser.pages()`.

**Automation engines.** All need a CDP target: `agent-browser` (`--cdp <port|url>`, `@eN` refs), Playwright MCP (`--cdp-endpoint`), Chrome DevTools MCP (`--browserUrl`, officially Chrome only), browser-use, Stagehand (`cdpUrl`).

**Others' embedding experience.** browser-mcp (from ZCode): `WebContentsView`, HTTP MCP with bearer token, 34 tools, refs in `window` die with navigation. AgentWorks #180: do not hand raw CDP to renderer, ACK screencast frames, broadcast only the visible. AgentsRoom: one persistent session per project, loopback WebSocket with token to the MCP process.

**Not found.** Cursor engine and Codex architecture; verified way into Google from Electron; whether Playwright sees `WebContentsView` over CDP in current Electron.
