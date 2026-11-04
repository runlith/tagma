---
id: 01a18458-1bc4-7369-ae0c-c675c7432228
title: A tools whitelist trims capability guidance only when the declared inventory proves no tool survives
ord: 6
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a11926-4535-762c-a8e7-af3319daf275
  - kind: relates
    to: 01a16bd1-914a-72f4-9e3a-60d9a3d78531
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/effectiveAgent.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/availability.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/cueRule.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/inventory.ts
---
A tools list narrows calls, not the capability grant or its law rules; the law audience is the definition's own `audience`, and without one `graph` for a holder of the graph capability, `executor` otherwise. Prompt sections, cue hints and availability guidance omit a capability only when its complete declared inventory has no tool admitted by the catalog resolver, including standing exemptions. Runtime and live sources with an incomplete inventory keep their guidance because a preview starts no connection and unknown is not empty; preview and thread birth share this projection.

The same inventories judge the list itself, but with the offers of every world (`CapabilityOffers.everywhere`), since a definition is portable and a tool offered only where there is history or a shared checkout may be missing here and present where the thread runs. A name in `tools` that no held capability could offer in any world refuses `agent-invalid` at preview, at the thread's first run and at refresh, naming the registered capability that offers it, since the resolver would drop it without a word; a name the current world merely lacks keeps today's behaviour. Only provable absence refuses: any held capability with an incomplete inventory, or a declared standing source whose names are unknown, may still bring the name at birth, so nothing is refused then. Only a definition that lists `capabilities` is judged: the list is what the author could correct, so a plugin agent (no list, the whole declared base, tools mapped from another format's names) never refuses. Conversation tools (`ask_user`, `tool_search`, `read_tool_output`) are exempt from the list and never counted absent.