---
id: 01a147b0-e165-75df-b2b0-9a0cf3ea399e
title: "Built-in Tagma browser: pages driven by humans, agents, and plugins on desktop and managed-Chromium hosts behind one CDP engine"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14742-3850-72e4-936c-2318838a9443
  - kind: relates
    to: 01a147e4-e266-7d95-ae42-070fbdb94d27
---
**What the user gets.** A browser inside Tagma, used by humans, agents, and plugins.
- A human opens pages in a panel beside the thread: address bar, tabs, back/forward, find, DevTools, downloads. Feed, terminal, and editor links open there too.
- An agent opens pages and works them with Tagma's built-in tools: a page snapshot with element links, clicks, input, screenshots, console and network. A human sees every action in the panel and can take over.
- A human hands the agent a page element: a click in pick mode drops the element's description, its frame, and a link into the chat input, and the agent acts on the link at once.
- Site sign-ins: permanent profiles and cookie import from Chrome, Edge, Arc, Brave, Comet, Helium, Firefox, and Safari.
- Agents work in a browser with no open desktop; the web client and the phone watch and drive any page by screencast.
- Next — profiles with a proxy and fingerprint spoofing on Chromium builds like fingerprint-chromium and ShardBrowser, AdsPower-grade tools, and plugins over the same operations.

Why not Chrome DevTools MCP: it drives a separate Chrome whose tabs Tagma knows nothing about — no shared panel with the human, no element picking, no phone screencast, no profiles, no own refusals. Reading other implementations is [[838a9443|the research]], the first sketch was [[e2fd39fc|the idea]].

**Concepts.**
- **Page** — one browsing context with its own history. The server holds its record: id (the server issues it), project, profile, URL, title, who opened it.
- **Host** — a process holding live pages. Stage 1 hosts: desktop (Electron main, `WebContentsView`) and managed Chromium (a server child process). Later — the user's Chrome.
- **Profile** — storage (cookies, storage, cache) and a browser identity. A profile stays bound to its host adapter forever; everything else the adapter needs to know about the profile (on managed — the build) lives in the adapter document. Electron partitions and Chromium user-data-dirs of another version are incompatible; moving sign-ins between profiles is cookie import from a Tagma profile.
- **Engine** — server-side automation over CDP: snapshot and links, input, capture, console and network buffers, screencast, element picking.

**Construction.**
- The server `browser` module owns pages, profiles, and automation. Agents, plugins, CLI, and clients work through its operations and feeds. Agent tools are operations with `tool` ([[54c5fcd2|tool and callers]]); operations and feeds needed by plugin processes admit an outside caller (`external`). Feeds have no such flag today — the platform adds it to `FeedDeclaration` and `admitFeed` in the same work. Plugin views show no live page at stage 1: a plugin process drives the browser through operations and feeds.
- One engine for all hosts talks to a host through ports: page life and navigation at host level plus an on-demand CDP session to the page. Human pages on desktop live without CDP until an agent drives them, another device watches them, or element picking runs: Cloudflare reads an attached debugger as a bot signal.
- The desktop host lives in Electron main and connects itself to its own server's socket: it registers, performs port calls, and forwards `webContents.debugger` frames. Raw CDP never leaves that channel and the server; there are no new listening ports.
- The managed-Chromium host is an adapter in the server: it launches a profiled build as a child process and talks CDP to it over a pipe.
- A hang verdict counts CPU consumed by the same attributed renderer process while a probe remains unanswered, never wall time. A host or frame session without exact attribution waits for its own answer or end and keeps the caller's cancellation.
- Whatever depends on the host or build — identity, page policies, storage place, fingerprint-config format — belongs to the adapter. The core knows the profile, its adapter, and its adapter document without reading it; at stage 2 — also the proxy.
- Showing is the client's business: a native view when this desktop holds the page, otherwise screencast. The only exception is desktop popup windows, which main shows. Server ports never include showing.

**Decisions and rejected options.**
- **`WebContentsView`, not `<webview>`.** The Tagma surface is a server page the window reloads when the server is silent ([[d6920c21|window and server]]) and after a client-build change on restart ([[9d333245|window restart]]). A `<webview>` would live in its DOM and die with every reload, losing human forms and agent progress. A `WebContentsView` belongs to main: pages survive surface reloads and server restarts, and an agent opens a page no panel shows. VS Code's browser works the same: only main creates and places a `WebContentsView`, and an overlapping overlay closes it with a screenshot ([[b8c9e955|reading]]). The price: Tagma overlays never draw over the native view; the fix is in the [[255c4582|desktop host]].
- **An own CDP engine in the server, not `agent-browser` or Playwright.** One engine for all hosts; buffers and links belong to the server; refusals are typed; no process per command. Moving to `agent-browser`, Orca returned keys and mouse to its own process (about 160 ms per press, wrong key codes) and got two engines, regexp links, and buffers in a daemon dying after 10 idle minutes ([[1ff1496a|research]]). The engine itself decides which CDP domains to enable: `Runtime.enable`, which Playwright turns on for every page, is an automation signal, and an AdsPower-grade profile without that control is meaningless. The counter-case — VS Code took Playwright over a synthesized endpoint and earned years of edge cases; the decision is revisited when, on a dozen real scenarios (sign-in form, SPA, cross-origin-iframe payment, shadow DOM, file upload), the own engine fails notably more often and one fix never closes the gap. Outside tools get a CDP endpoint from the server at stage 2.
- **Raw CDP over the host channel, not high-level commands in Electron main.** Otherwise managed Chromium would bring a second engine, and parsing accessibility trees and buffers would load the event loop that drives window input.
- **A channel over the server socket, not a desktop loopback CDP port.** The local Tagma door already admits any local process as an operator, so the gain is not in admission strength: admission is one, there is no new listening port, and raw CDP travels only between host and server. At Orca every tab had its own loopback port with no token. For the same reason managed Chromium talks over `--remote-debugging-pipe`, not a port.
- **Agents work in the desktop browser by default, and in managed Chromium when the application is not running.** The operator's decision: in ordinary Mac work agent pages are native, and from the phone the human moves to the same live page. While the application process lives and the channel reconnects (server restart, socket drop), an agent action waits for the host's return — without a deadline, that is waiting on a living process. With no application process the action answers `host-away` with the connected hosts' profiles, and the agent itself opens a page in a managed-Chromium profile; there is no silent profile substitution. A windowless Tagma.app as an agent host is rejected: an application launching a background server is fragile — single-instance, a dock icon, launching from a background process. The price is agent traffic through main's event loop (measured in the [[255c4582|desktop host]]), and different agent-profile sign-ins on desktop and on the managed host, moved by import.

**Default profiles.** Profiles are machine-scoped, like provider accounts. Two settings — `browser.userProfile` and `browser.agentProfile` — at project level over the operator value; both default to desktop profiles: the user profile and the agent profile. Human pages open in the first, agent pages in the second; an agent may name any profile. For work with no running application there is a managed-Chromium agent profile: the agent takes it itself on a `host-away` refusal. Profile resolution never substitutes a profile: a host that is not connected answers `host-away`. There are no bans against agents: profiles and import are operations for any caller, and a human steps in only where the OS requires it (the Keychain prompt).

**Stages.**
1. **Orca level.** Ships in steps:
   1. the `browser` module core: engine, tools, profiles, and two default settings; the desktop host; a minimal managed host on Chrome for Testing with no screencast — the engine system tests' target; a panel with tabs; element-to-chat picking; link routing;
   2. a managed host for agents with no application, an installed-Chrome build, and screencast to the desktop panel, the web, and the phone;
   3. a profiles section in settings and cookie import on macOS.
2. **AdsPower level.** Profile proxy; fingerprint-spoofing build adapters; windowed managed profiles; profile extensions; a profile editor with groups and bulk launch; moving profiles between machines; a page CDP endpoint for outside tools and DevTools as a client of the same multiplexer; per-thread ephemeral agent contexts; a "User's Chrome" host. The stage 1 port shape already carries context and a multiplexer, so stage 2 adds adapters and clients without changing the core.

Firefox engines are out of scope: the port is CDP, the adapters are Chromium builds.

**What experiments established and what stays unproven.** Full setups and limits are in the [[bdb94d27|experiment results]]. Electron 44.8.0 / Chromium 152.0.7977.167, macOS arm64; the headless experiment is Chrome for Testing 149.0.7827.55.
- A never-shown parking lot draws a `WebContentsView`, yields native capture, CDP screenshots, and screencast with background throttling off. Capture waits for a ready frame: right after load the native surface may still be missing. Moving between windows and closing a window keep the page; main closes it explicitly.
- Screenshots work through CDP. `Page.printToPDF` is missing from CDP on Electron, while native `webContents.printToPDF` works: printing to PDF becomes a `PageHost` action, and managed Chromium performs the same contract through CDP.
- `Overlay.setInspectMode` yields `Overlay.inspectNodeRequested`; no script substitute is needed. This build requires `highlightConfig:{}` even when turning the mode off.
- Input and ArrowLeft pass with focus emulation into a hidden page, `webContents.isFocused()` stays false. Keeping another active window's pid is not measured separately.
- `Log.enable` never yields JS console; `Runtime.enable` does and can deliver saved earlier console messages. The enable policy is in the [[39241ecf|engine]].
- Core experiments on Bun 1.4.3 confirmed `--remote-debugging-pipe` with Chrome for Testing 151 ([[eb1e2301|managed host]]); no separate CDP port is needed.
- Desktop main reads the import Keychain key through Security.framework ([[eae10179|import]]). The synthetic record showed the `security` and `bun` request identities; the operator pressed Always Allow for Bun, but the final ACL was never removed before the record's deletion. The signed Tagma release's identity and ACL stay a check on a synthetic record.
- Detached `alert`/`confirm` go through Electron's native handler, with no public event. CDP reports and answers a connected page's, but the native dispatch runs too; the absence of a second real window stays unproven. Electron 44.8.0 does not support `prompt()`. `will-prevent-unload` resolves synchronously, so main first holds the leave and repeats the agreed action after the answer. That is no hanging CDP dialog.
- With an attached debugger a hung page never yielded `unresponsive` inside the experiment window; without one the `unresponsive` and `responsive` events arrive. Desktop checks the renderer with a separate light request outside the page queue, like managed.
- Windowless Chrome for Testing on this machine wrote cookies with no Keychain prompt; a clean account's first launch is unproven. `--use-mock-keychain` is verified, priced at cookies under a mock key in a 0700 directory; the choice belongs to the build.

Parts:
- [[39241ecf|server browser module: pages, profiles, host ports, engine, and tools]]
- [[255c4582|desktop host]]
- [[e3064958|browser panel in the client]]
- [[eb1e2301|managed Chromium and screencast]]
- [[eae10179|cookie import]]
- [[e9ce3844|AdsPower-grade profiles]]

**Volume estimate** (rough, by Orca lines and the parts' composition): stage 1 — 20–26K lines, stage 2 — 4–7K plus ongoing build maintenance.

**What the operator checks** (not a completion condition): sign-in to Google, GitHub, and a Cloudflare-gated site in the panel; an agent walks a scenario on its own dev server while a human watches; element picking and edits from it; a page from the phone.
