---
id: 01a14c08-1c3f-7bde-a2e3-0474f94d548e
title: Agent reads a page by URL as markdown, text, or HTML, and a picture as an image
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04644096201b
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-047574109856
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/web.ts
  - kind: file
    ref: packages/agent-tools/src/webfetch.ts
---
**Value.** The agent reads a page by URL in whatever text suits it, without opening a browser.

**How.** The `webfetch` tool of the `web` capability: markdown (default), text, or HTML, with an optional deadline.

**Behaviour.**
- HTML becomes markdown or text, with no scripts or styles; a picture reaches the agent as an image.
- Redirects pass only within the same origin (with and without `www.`); leaving for another origin refuses and asks to call `webfetch` with the new URL, so the approval targets the real destination.
- The request goes through the thread world's network egress; in review mode reading a page asks for approval.

**Limits.** A response over 5 MiB and a non-2xx status refuse. Page JavaScript does not run — a SPA needs the [[4096201b|browser]]. With provider web that declares reading, [[74109856|provider reading]] applies instead.
