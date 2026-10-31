---
id: 01a1942e-f357-7156-8927-5efbfe6328e6
title: Choose reflection storage before its first durable write
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd90-73db-9615-876f36cf9295",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1942e-6df6-79ef-83da-0bdecfbfaabc
  - kind: relates
    to: 01a1941f-f2bb-77f3-9717-654e6b8cdc4b
---
file_reflection now accepts the existing storage choice and passes it into the initial Blocks.create call for both an entry and a new sighting. Omitting it still inherits the parent's storage, and the graph keeps its existing storage refusals. The native public-door regression first created a team record despite storage: stealth; after the fix it reads stealth immediately, has only its create event, and leaves no version in team Git history after sync. The unchanged default still creates a team entry. The changed HTTP/native scenario and fork-prefix scenario pass on seeds 1, 2 and 3; server typecheck passes. No default policy, history, or repository pin was changed.