---
id: 01a15efe-b815-742a-9efa-f695f9aa4a47
title: Recovering a call from the graph journal hangs on module acts that never write the graph journal
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ee6-3ee9-7f2c-80c4-fa034460ff77",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15ec6-76e2-7b94-a563-dc2f18649014
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/operationCatalog.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/manifest.ts
---
`journaled` in the manifests inherited the makeup of the former `graph` voice: the settings, performance, installation, and mcp modules, landing's `submit_work`, and `read_installation_status` in external-harnesses. For their acts with `identity: { key }`, composition substitutes `settle: settleJournalCall`, which looks the call up in the graph journal. These acts never write to the graph journal, so after a restart `settle` always answers `not-happened`, and the door names the call interrupted — though `vacuum_database` or `write_setting` may have executed.

To do: only modules whose acts write to the graph journal (graph, reflections) declare `journaled`; the rest need their own `settle` or an honest `unknown`. The app takes the same `JOURNALED_OPERATION_IDS` list for the graph line in the feed (`graphTools.feed.svelte`, `ToolResultRow.svelte`), so the `read_performance` line and the rest must be registered at their owner by the same change.
