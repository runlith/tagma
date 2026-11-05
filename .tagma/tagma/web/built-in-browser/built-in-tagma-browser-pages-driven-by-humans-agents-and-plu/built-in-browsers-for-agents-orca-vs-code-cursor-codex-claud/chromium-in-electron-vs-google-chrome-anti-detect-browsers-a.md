---
id: 01a1474d-94e5-79b5-bc84-a6d5486f5a5e
title: Chromium in Electron vs Google Chrome, anti-detect browsers (AdsPower, GoLogin, Multilogin), and open fingerprint-spoofing builds
ord: 6
tags: ["research"]
fields:
  {
    "source": {
      "name": "AdsPower Local API docs, GoLogin SDK, Multilogin X; fingerprint-chromium, ShardBrowser, Camoufox, Cromite READMEs",
      "ref": "https://localapi-doc-en.adspower.com/docs/FFMFMf"
    }
  }
---
Vendor docs and project READMEs as of 2026-10-17; no binary was launched. "Conclusion" marks an inference, not something read in a source.

**How Chromium in Electron differs from Google Chrome.** Network, TLS, and engine match Chromium of the same version (Electron 44.8 is Chromium 152). The differences are in the page environment:
- Read in the Orca code ([[447be62e|profiles and UA]]): the default UA carries `Electron/x` and the app name; client hints report the "Chromium" brand without "Google Chrome"; an attached debugger reads as a bot signal to Cloudflare; JS "stealth" spoofs have themselves become bot signatures.
- Conclusion, not verified in this reading: Electron lacks what the Chrome layer itself implements — `chrome.loadTimes`, `chrome.csi`, Google voices in `speechSynthesis`, Widevine, extensions, Safe Browsing; Chromium in Electron lags stable Chrome by one or two versions. Strict anti-bots catch mismatches between the claimed UA and such an environment.

**Anti-detect browsers.** These are their own Chromium (or Firefox) builds, launched as separate processes; a manager app owns profiles and serves a CDP endpoint.
- AdsPower: Local API `GET /api/v1/browser/start?user_id=…` with a bearer key returns `ws.puppeteer` (`ws://127.0.0.1:<port>/devtools/browser/…`), `ws.selenium`, `debug_port`, and the chromedriver path; the port changes on every start; the profile lives until `/api/v1/browser/stop` ([docs](https://localapi-doc-en.adspower.com/docs/FFMFMf)).
- GoLogin: SDK `start()` returns a `wsUrl` for `puppeteer.connect`; the Orbita browser, binary path set via `executablePath` ([npm gologin](https://www.npmjs.com/package/gologin)).
- Multilogin X: starting a profile via `launcher.mlx.yt:45001/api/v2/…/start?automation_type=puppeteer` returns the CDP port; needs a running app; Puppeteer works only with Mimic (Chromium) profiles ([help](https://multilogin.com/help/en_US/puppeteer-automation-example)).
- Fingerprint spoofing, per the projects' claims, is done in engine C++: canvas, WebGL, WebGPU, audio, fonts, screen, navigator, client hints, timezone, WebRTC.

**Open bases for your own build.**
- [fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) — on ungoogled-chromium; Chrome 150 builds for Windows and Linux, 148 for macOS; patches published with about a month's delay.
- [ShardBrowser](https://github.com/ProxyShard/ShardBrowser) — engine-level spoofing on Chromium 152, 220+ device profiles, QUIC and WebRTC over SOCKS5.
- [Camoufox](https://github.com/CloverLabsAI/camoufox) — Firefox with C++ spoofing; driven by Playwright via Juggler, not CDP; no profile manager.
- [Cromite](https://github.com/uazo/cromite) — a privacy browser with anti-fingerprinting flags; not meant for identity spoofing.

**Can you put your own build inside an Electron window.** No: `<webview>` and `WebContentsView` run only on Electron's own Chromium, and another process's window cannot be embedded into an Electron window on macOS (conclusion from the Electron device). Inside a panel your own build can only be shown by relaying CDP screencast with forwarded input; natively — in separate windows, like AdsPower; or by building your own Electron on patched Chromium.

**Cost of your own build** (estimate, not measured): Chromium checkout over 100 GB, a full build takes hours on a strong machine, CI on macOS, Windows, and Linux with signing; porting patches to every Chrome every four weeks — otherwise version lag itself becomes a signal; continuous checks against CreepJS, pixelscan, fingerprint.com.
