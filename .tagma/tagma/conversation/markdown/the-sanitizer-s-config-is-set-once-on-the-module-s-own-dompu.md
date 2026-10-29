---
id: 01a1846a-7098-71de-9746-ca4c1d9ba020
title: The sanitizer's config is set once on the module's own DOMPurify instance
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18404-f6df-7814-bb9e-c815d7dbe006
sources:
  - kind: symbol
    ref: packages/markdown/src/render.ts
    symbol: sanitizeHtml
---
A config passed to `sanitize` is re-parsed on every call — sets rebuilt, patterns checked — and that was about half of the sanitize cost when a feed mount painted a window of bodies. The instance belongs to this module alone, so one `setConfig` at creation holds for every call; a call that needs other rules needs its own instance, never a per-call config on this one.