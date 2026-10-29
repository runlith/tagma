---
id: 01a14742-3850-72e4-936c-2317e2fd39fc
title: "Built-in browser in Tagma desktop: pages in a panel, driven by the user, agents, and plugins"
ord: 9
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14742-3850-72e4-936c-2318838a9443
  - kind: relates
    to: 01a147b0-e165-75df-b2b0-9a0cf3ea399e
---
**Question.** Give Tagma on desktop its own browser: the human opens pages in app panels, agents drive them natively — instead of Chrome DevTools MCP — and plugins and integrations build on top. The operator wants a subsystem, not one panel. Reading others' implementations is the [[838a9443|study]].

**What the Tagma layout changes.** Agents live in the Bun server, the page in a window belongs to Electron main, and desktop currently speaks to the server only with one-shot HTTP requests. So a "server → window main" channel is needed, and a page in a window is unreachable when the window is closed while the server with agents keeps working. It is the same problem as Orca's with client-hosted pages and orcad, on one machine and one server.

**Sketch read from the study** (not a decision):
- The server `browser` module holds the page registry, operations, and agent tools; everything engine-dependent is adapters behind its port.
- The port is a "CDP session to a page and its life": the desktop-window adapter relays `webContents.debugger` over the channel to the server; a headless adapter is Chromium or a sidecar Electron from the Tagma bundle ([[ac637dff]]); later, an adapter for "the user's real Chrome" for signing into Google, banks, and strict anti-bots. Then one automation engine (snapshot with refs, input, console/network, screencast) in the server works with all adapters, and broadcast to web and phone is one more CDP stream.
- Agents get built-in tools, as in VS Code; plugins get server operations; the user hands a page element to chat.
- The "managed browser" adapter covers what the built-in Electron Chromium cannot pull: fingerprint spoofing, multi-accounts, as in AdsPower ([[486f5a5e|anti-detect browsers]]). Tagma holds profiles (spoof config, proxy, data dir), launches a separate browser process with a profile, and attaches over CDP; the binary is swappable — Chrome for Testing with no spoofing, then an open spoofing build, then its own if needed. Another process's Chromium never stands inside an Electron window: display is separate windows or broadcast into the panel. Firefox-engine drivers (Camoufox) are out of plan per the operator's word: the port stays CDP, adapters only Chromium builds.

**Open choices.**
- `<webview>` (Orca; Tagma overlay HTML paints over it, but the guest dies on DOM move and input passes renderer by) or `WebContentsView` (Electron-recommended, but lies over all window HTML — palette, menu, and overlays never get under it).
- Engine: its own on CDP (Orca abandoned its own, VS Code has built-in) or `agent-browser`/Playwright over a CDP bridge.
- Agent profile: shared with the user (Orca) or separate (VS Code, Codex, Claude Code).
- Where to run input: a CDP bridge into the server or high-level commands executed in main.
- Whether its own Chromium build with fingerprint spoofing is needed: its own fork is permanent work (porting patches every four weeks, CI on three OSes, detector checks); decided after the "managed browser" adapter, once it shows where spoofing is unavoidable.

**Size estimate** (rough, by Orca lines): a human browser in the panel is 4–6k lines; agent driving in the window 4–6k more; a headless adapter 2–3k; broadcast to web and phone 3–5k. Cookie import, network routing via a remote host, and element picking are separate.

**What hurts most** (by Orca experience): signing into Google (a second "identity" is needed on sign-in pages), no single UA passes all anti-bots, the debugger is a bot signal for Cloudflare and conflicts with DevTools, the webview guest dies on DOM move, input misses the renderer process, CDP on webview is partly broken (screenshot, PDF, subscriptions after process swap), broadcast needs ACK and dead-viewer eviction.
