---
id: 01a184dc-4fbe-7b01-a2d5-4fa84aecb62a
title: "CPU and network throttling and geolocation: the CDP commands, their scope and what a page sees"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "chrome-devtools-mcp emulate tool; CDP Emulation and Network",
      "ref": "chrome-devtools-mcp 63170b11a2fa74d5ceea757194d7b25f3e145f68 src/tools/emulation.ts, src/McpPage.ts; devtools-protocol master Emulation.pdl, Network.pdl, Browser.pdl; Chromium main inspector_emulation_agent.cc; Chromium 151.0.7922.71 content/browser/devtools/protocol/emulation_handler.cc"
    }
  }
---
**chrome-devtools-mcp, observed** (`src/tools/emulation.ts`, `src/McpPage.ts`):
- `emulate` replaces every emulation setting on each call (extra headers excepted): `networkConditions` (`Offline` or puppeteer's `PredefinedNetworkConditions`: Slow 3G, Fast 3G, Slow 4G, Fast 4G), `cpuThrottlingRate` 1–20, `geolocation` `<lat>,<lon>`, plus user agent, color scheme, forced colors, contrast, reduced motion, viewport and extra headers.
- It applies through puppeteer `emulateNetworkConditions`, `emulateCPUThrottling` (also sent to the second DevTools-frontend session of the page) and `setGeolocation`. Network throttling is refused while a request block or allow list is configured, which conflicts with puppeteer's request interception.
- Waits scale with conditions: the default action timeout is multiplied by the CPU rate, the navigation timeout by the network multiplier and the CPU rate, and the post-action wait helper takes both multipliers.
- The page's CPU rate and network preset ride into trace metadata, so a trace states its conditions.

**CDP and Chromium.**
- `Emulation.setCPUThrottlingRate {rate}`. Blink's `InspectorEmulationAgent::setCPUThrottlingRate` sets `scheduler::ThreadCPUThrottler::GetInstance()`, a per-renderer-process singleton, and the agent resets the rate to 1 when it is disabled, that is when the session ends. Inference: every page and same-process frame of that renderer slows down, while out-of-process iframes run unthrottled unless their own sessions set a rate.
- `Network.emulateNetworkConditions` is deprecated in favour of `Network.emulateNetworkConditionsByRule {matchedNetworkConditions: [{urlPattern, latency, downloadThroughput, uploadThroughput, connectionType, offline}], emulateOfflineServiceWorker}` — an empty pattern matches every request including p2p — together with `Network.overrideNetworkState`, which alone changes `navigator.onLine` and `navigator.connection`. A 2016 Chromium review says the old command changed a global network-state notifier, so all pages saw the new state. The by-rule command appears in Selenium's generated bindings from V142, so it exists in Chromium 151 and 152.
- `Emulation.setGeolocationOverride {latitude, longitude, accuracy, …}` sets the position; `Emulation.clearGeolocationOverride` removes it. In Chromium 151.0.7922.71 `content/browser/devtools/protocol/emulation_handler.cc`, omitted coordinates install a position-unavailable error rather than clearing. The override belongs to the WebContents: applying it to an out-of-process frame makes that child's session disable clear the same override the root uses, so only the root session sets it. The page still needs the geolocation permission. Granting it over CDP is `Browser.setPermission` (`grantPermissions` is deprecated), a browser-target command keyed by origin and browser context. Inference: a `webContents.debugger` session, attached to a page, cannot reach it; on Electron the grant is the partition session's permission handlers in main.

**Cost and detection (inference).** Each condition is one command. A page notices CPU and network throttling only through timing; by-rule network emulation leaves `navigator` untouched. An emulated position is indistinguishable from a real one to the page. None of these needs `Runtime.enable`.

**On both hosts (inference).** The Emulation and Network handlers belong to every page session, so the three commands should work through `webContents.debugger` and over the pipe; only the geolocation permission differs: Electron main's session handlers on desktop, `Browser.setPermission` on the profile's browser session over the pipe.
