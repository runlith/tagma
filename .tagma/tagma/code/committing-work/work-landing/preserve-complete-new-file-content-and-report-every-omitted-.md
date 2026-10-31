---
id: 01a193f6-b401-767a-a298-94757ca68b8b
title: Preserve complete new-file content and report every omitted line at landing
ord: 166
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f6-f75d-7c61-9922-072ae87930db",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a18c11-c7b0-7462-a567-687496bd391f
  - kind: discovered-from
    to: 01a19132-28f5-7e42-ac8d-5d32d29d6435
---
Reproduce the migration and generated-file truncation reports through submit_work, fix their cause at the change-record or landing owner, and prove new-file content cannot silently disappear. Preserve independent peer authorship. Check related attribution reports only where they share this cause; land the fix and answer each reflection with its evidence.