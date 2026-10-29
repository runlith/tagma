---
id: 01a184dc-4fbe-7b01-a2d5-4fa9ddb8b6fa
title: "Lighthouse in chrome-devtools-mcp: a puppeteer-bound bundle that enables Runtime and Debugger and resets origin storage"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "chrome-devtools-mcp lighthouse_audit; Lighthouse 13.6",
      "ref": "chrome-devtools-mcp 63170b11a2fa74d5ceea757194d7b25f3e145f68 src/tools/lighthouse.ts, src/third_party/lighthouse-devtools-mcp-bundle.js; npm lighthouse 13.6.0 and axe-core 4.14.0 metadata"
    }
  }
---
**chrome-devtools-mcp, observed** (`src/tools/lighthouse.ts`, `src/third_party/`):
- `lighthouse_audit {mode: navigation|snapshot, device: desktop|mobile, outputDirPath?}` runs only the accessibility, SEO, best-practices and agentic-browsing categories; its description sends performance to the trace tools instead. Navigation mode reloads and audits; snapshot mode audits the current state. Desktop is 1350×940 at scale 1 with a Chrome/136 desktop UA; mobile is 412×823 at 1.75 with a Moto G Chrome/136 UA. Load waits at most 30 s.
- Reports are written as JSON and HTML; the answer carries category scores and failed audits with at most 10 flagged DOM nodes each. Afterwards the page's own emulation is restored, with a viewport width-minus-one step because Lighthouse's session clears the device metrics override on detach.
- Lighthouse is a single 3.75 MB file (`lighthouse-devtools-mcp-bundle.js`, header Lighthouse 13.6.0, 2026-10-28), imported lazily on first use; its API takes a puppeteer `Page`. The npm `lighthouse` 13.6.0 is 19.4 MB unpacked with 22 dependencies, among them `puppeteer-core`, `@sentry/node`, `axe-core`, `chrome-launcher` and `@paulirish/trace_engine`.

**What the bundle does to the page** (read in the bundle):
- Enables `Page`, `Network`, `Runtime`, `DOM`, `CSS`, `Debugger`, `Log`, `Audits` (and `WebMCP`), and turns on async stacks through the debugger.
- Navigation mode: `Storage.clearDataForOrigin` for `file_systems`, `shader_cache`, `service_workers`, `cache_storage` (defaults, `disableStorageReset: false`) before and after the run, a browser-cache clear, automatic acceptance of every JavaScript dialog (prompt answered "Lighthouse prompt response"), its own throttling, device and UA emulation, `Network.setBlockedURLs`, and a `requestIdleCallback` shim injected into each new document.
- Accessibility audits are axe-core run inside the page. axe-core 4.14.0's `axe.min.js` is 652 KB (package 3.4 MB unpacked).

**Detection and side effects (inference from the commands).** `Runtime.enable` and `Debugger.enable` are the classic automation signals; a Chrome/136 UA override disagrees with the real browser's client hints. On a persistent profile, navigation mode deletes the origin's service workers and Cache Storage and the browser HTTP cache — state a signed-in user keeps.

**On the two hosts (inference).** Lighthouse wants a puppeteer `Page`, which needs a puppeteer `Connection` over a transport. `webContents.debugger` offers no puppeteer transport; over the pipe puppeteer could connect, but as a second CDP client stack beside any existing one, issuing its own `Target.setAutoAttach`, emulation and storage commands. Its audits compute in the hosting JavaScript process.
