---
id: 01a14742-3850-72e4-936c-231b359d6572
title: "Orca: the page lives in the desktop window or in server Electron, and the Node server does not broadcast it"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "Orca 0df25b7 — browser-client-*, paired-runtime-browser-*, screencast, orcad, network tunnel",
      "ref": ".external/orca/src"
    }
  }
---
Paths are relative to `.external/orca/src/`. Nothing was launched.

**Two page shapes.** Client-hosted — painted in the `<webview>` of an attached desktop; without one, commands answer `browser_host_unavailable`. Server-hosted — lives in a windowless server process. The desktop chooses the shape at creation (`main/browser/browser-client-host-placement-preparation.ts`); the server only validates.

**The Orca server is not necessarily Electron.** `orca serve` launches orcad by default — plain Node (`main/orcad/orcad-local-serve-selection.ts:6-7`). Electron `--serve` is the fallback: a packaged app on macOS (orcad has no updater), profiles over SSH, env, or orcad failure. Server-hosted pages in Electron are hidden `BrowserWindow`; Linux needs Xvfb because Electron `--headless` crashes. orcad has two browser providers (`main/orcad/orcad-browser-provider.ts`): installed Orca.app as a sidecar over RPC, or Chromium from `ORCA_BROWSER_EXECUTABLE` driven by `agent-browser` directly. Both refuse screencast.

**Command route to client-hosted.** Page registry on the server: the client mints the id, placement is `(hostId, hostGeneration, pageGeneration)`, duplicates rejected. The desktop holds a lease over an authenticated channel (one per connection, four per device). Commands go through a ledger: per-page numbers, ordering, result cache; on break, unfinished ones answer `outcome_unknown`, with no silent retry. Host loss: 15 s to reconnect, then placement is lifted, the page record stays, a returned host with the same id reclaims its pages. "Open on server" creates a new page at the last url — live state is lost.

**Broadcast.** Server-hosted only: `Page.startScreencast` with ACK per frame (without ACK Chromium stops sending), one stream per page fanned out to all viewers, budget set by the weakest viewer, ghost subscribers evicted after 90 refusals, a static page sends no frames — fallback is `captureScreenshot`, background throttling off. Input back is RPC per event, wheel at most per animation frame. On phones JPEG q72, width by screen density. Only its host sees a client-hosted page: a phone lists it but cannot watch (conclusion).

**Network via the workspace host.** So that the page's `localhost` is the remote machine's localhost: loopback SOCKS5 in desktop main, the partition gets a proxy with `<-loopback>`, the proxy is verified before first paint, WebRTC with no unproxied UDP, the tunnel is one binary stream to the server (opcodes, windows, budgets). QUIC, WebTransport, and DNS prefetch bypass SOCKS — Orca has dedicated stands that catch this.

**Size.** Client-hosted management about 13.3k lines; file channel 1k; tunnels and SSH/WSL 5.5k; headless and orcad providers 3.5k; screencast 1.8k; desktop viewing 4.4k; phone browser 3.8k.

**Lessons.** Storage must not be keyed by process id: a per-process UUID in the partition name wiped cookies on every server restart. The "can client-host" predicate must be one for renderer and main, or the panel hangs with no placement. Downloaded files must outlive the command: Chromium opens them lazily.
