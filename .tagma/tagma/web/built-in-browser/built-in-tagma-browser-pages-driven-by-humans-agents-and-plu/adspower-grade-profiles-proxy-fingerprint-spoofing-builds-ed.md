---
id: 01a147b0-e165-75df-b2b0-9a12e9ce3844
title: "AdsPower-grade profiles: proxy, fingerprint-spoofing builds, editor, CDP endpoint, per-thread contexts, and the user's Chrome"
ord: 6
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
Stage 2 makes a Tagma profile what it is in AdsPower: an identity with a proxy and a fingerprint, windowed or headless, driven by humans, agents, and apps. The ports and engine of the [[39241ecf|browser module]] already carry the page context and the session multiplexer; stage 2 adds the proxy attribute, build adapters, multiplexer clients, and a host.

**Profile proxy.** The only new profile attribute in the core: it means the same on every host. Proxy credentials live in server secrets, not in the profile string.
- Desktop applies it to the profile partition and answers authorization with a `login` event — no CDP, because human pages live without a debugger; managed Chromium — with a launch argument and `Fetch.authRequired` on its service session.
- WebRTC with no unproxied UDP.
- The proxy is verified before the first page load: the page does not render on an unproxied session.
- QUIC, WebTransport, and DNS prefetch can bypass a proxy — Orca keeps separate stands for that ([[359d6572|research]]); the build and the host close those paths, and a measurement proves it.

**Fingerprint-spoofing builds.** Adapters under the build contract ([[eb1e2301|managed Chromium]]): fingerprint-chromium, ShardBrowser, or another base ([[486f5a5e|survey]]). Each declares a fingerprint-config schema — OS, screen, fonts, WebGL, timezone, language, seed — and translates it into launch arguments. The config lives in the adapter document; the core does not read it. Profiles of such builds default console capture to `never`.

**Windows.** A managed-Chromium profile opens in a window of the build itself, as in AdsPower, or headless; the mode lives in the adapter document. A build window is a third `PageView` adapter ([[e3064958|panel]]): the panel shows that the page is in a build window and brings it forward. In the window a human signs into Google and uses passkeys.

**Profile extensions.** The extension set lives in the adapter document and installs at launch. Only builds that load extensions from arguments qualify: branded Chrome since 137 ignores `--load-extension` (from memory, verified in work), so extensions belong to Chrome for Testing and open builds.

**Profile editor.** A client section: profile list with host, build, proxy, and state; groups and bulk launch; a config form by the build schema; cloning; moving a profile to another machine as an archive — document, storage, and cookies; launching a page in a profile. An app can build its own manager over the same operations and feeds.

**Page CDP endpoint and DevTools.** The server hands an admitted caller a CDP endpoint for one page — for Playwright, `agent-browser`, or Chrome DevTools MCP — as one more client of its session multiplexer: the outside tool sees neither Electron nor the managed-Chromium pipe. Panel DevTools becomes a client of the same multiplexer, and open DevTools no longer take the page from the agent.

**Per-thread agent contexts.** An ephemeral browser context per thread (`Target.createBrowserContext`, on desktop — an in-memory partition): agents signing into different accounts on one site do not disturb each other. The port already opens a page in a context, and the page record carries it.

**"User's Chrome" host.** The human's real Chrome with its sign-ins and extensions — through an extension or a Chrome-permission connection; a separate port adapter.

**An own Chromium build** is a separate decision after open-build adapters, once it is clear where an own spoof cannot be avoided: porting patches to every Chrome release every four weeks, builds on three OSes, constant detector checks.

**What the performer proves.** A proxied-profile page reaches the network only through the proxy (TCP, QUIC, DNS, WebRTC); the fingerprint config reaches the page coherently in the document and workers; an outside Playwright drives a desktop page through the server endpoint while an agent works the same page; open DevTools do not interrupt the agent; two threads in ephemeral contexts sign into one site with different accounts.
