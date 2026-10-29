---
id: 01a165dc-fad8-7387-9424-bcb5beb846f8
title: The operator switches a setting the agent named in its answer right in the feed
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a2b526a4f0
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/settings/chips
  - kind: file
    ref: apps/tagma/server/src/settings/doctrine/keys.ts
---
**Value.** An agent advises "switch on `telemetry.cpuSampler`", and the operator changes the value where they read the advice: no Settings screen and no extra agent turn. Keys an agent may not write are changed by the operator the same way: it is their own write.

**How.** A setting key in backticks in an answer becomes a chip. A boolean key's chip carries a small switch; hovering a key opens a popover with the description, the same control as in Settings, the value provenance and a move to the thread-home project's Settings. The system prompt tells agents to name the setting by its exact key.

**Behaviour.** Only the thread-home catalog's exact key becomes a chip, and only in a finished answer block: while the answer streams, finished paragraphs already carry chips, the growing tail does not, and the stream end does not recreate them; other code and file-link captions are untouched. Writing goes to the layer the effective value came from, or to the machine layer on a default. A write refusal shows in the popover with a code and a way out.

**Limits.** Only the thread feed: graph block bodies have no chips. List keys, tables, colours and managed keys are not edited in the popover — it leads to Settings. A value an agent changed is visible after the catalog is re-read; opening the popover does that.
