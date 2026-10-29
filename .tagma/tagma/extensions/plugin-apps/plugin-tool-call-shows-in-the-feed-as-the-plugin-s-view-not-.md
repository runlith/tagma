---
id: 01a14c08-8336-7b3c-965a-b09689f8466a
title: Plugin tool call shows in the feed as the plugin's view, not the tool's answer
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b095d946528f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/pluginViews.feed.svelte
  - kind: file
    ref: apps/tagma/server/src/views/contract/wire/points.ts
  - kind: file
    ref: apps/tagma/server/src/views/shelf.ts
---
**Value.** A plugin tool call shows in the feed as the plugin's own view — a dealt hand, a deal card — not as a JSON answer.

**How.** The `results` point ties a plugin tool to a view from `views`; the feed draws that tool's call with the plugin's view.

**Behaviour.**
- The view gets the call's input and result and the thread it stands in.
- A `live` view keeps working when scrolled out of sight, within the feed's budget; the rest are dropped off-screen.
- A result can be tied only to a tool an agent calls (`agents` or `own`): a view for a `view`-audience tool or an unnamed one is a plugin error at startup, not an install refusal.

**Limits.** A view is drawn while the plugin is enabled in the project and running; otherwise the feed row shows as a plain tool card.
