---
id: 01a147d6-7ef4-7c9c-9e39-feaa461a081e
title: "Browser core: the @runlith/cdp kit, the server browser module with engine and tools, a minimal managed host on Chrome for Testing"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a0d39241ecf
---
Step 1.1 of the core per the [[39241ecf|browser module]] and the minimal managed host from its [[eb1e2301|part]]: what the desktop host, the panel, the screencast, and the import stand on.

What to do:
- the `@runlith/cdp` kit (`packages/cdp`): a CDP-session contract with multiplexer and domain counter, protocol types, primitives — the accessibility tree and links (target, document generation, `backendNodeId`), the US key table, mouse input, capture, ring buffers, node description; large results as opaque text with worker parsing;
- the server `browser` module: a `#module` card (`set_module`), profile and page tables, `PageHost` and `ProfileHost` ports with page context, the host registry, the engine (on-demand session, domains and profile console capture, queue, `page-unresponsive`, links, snapshot, focus-emulated actions, emulation, capture, buffers, downloads, dialogs, element picking, DevTools `taken`/`released`), operations and feeds with the spec's refusals, two default-profile settings;
- platform: the `external` flag on `FeedDeclaration`, read by `admitFeed`;
- the `managed` adapter — its own module: a per-profile Chromium child process, `--remote-debugging-pipe`, `--headless=new`, a `Page`-only service session on the page, the `chrome-for-testing` build with download and `build-unavailable`. No screencast or `installed-chrome` — that is step 1.2.

First — two experiments this code depends on: whether `--remote-debugging-pipe` holds under Bun 1.4 (otherwise port 0 and `DevToolsActivePort` in a 0700 directory) and whether `console.error` arrives through a single `Log.enable`. Outcomes go into the spec.

Done when: the engine system tests from the module spec's "what the performer proves" pass against the managed host on Chrome for Testing from a known cache directory (with no binary the test fails); `bun run typecheck` is clean; review by the model rule is done and findings sorted; the commit goes through `submit_work`.
