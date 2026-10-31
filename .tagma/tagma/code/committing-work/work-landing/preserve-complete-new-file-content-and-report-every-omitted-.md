---
id: 01a193f6-b401-767a-a298-94757ca68b8b
title: Preserve complete new-file content and report every omitted line at landing
ord: 166
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f6-f75d-7c61-9922-072ae87930db",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18c11-c7b0-7462-a567-687496bd391f
  - kind: discovered-from
    to: 01a19132-28f5-7e42-ac8d-5d32d29d6435
---
Reproduce the migration and generated-file truncation reports through submit_work, fix their cause at the change-record or landing owner, and prove new-file content cannot silently disappear. Preserve independent peer authorship. Check related attribution reports only where they share this cause; land the fix and answer each reflection with its evidence. The native submit_work regression reproduced silent truncation of an unowned new-file base followed by recorded edits, then an omitted unowned remainder on a partially landed existing path. Creation links now require that base through a matching carry or explicit whole; the receipt uses one Holdings judgement for held and unowned leftovers. The native regression passed on seeds 1–3, 67 fold checks and 14 focused landing checks passed, and server typecheck passed. The retired records of the original generated snapshot cannot reconstruct its historical attribution chain; the test proves the current truncation shape, not that lost chain.