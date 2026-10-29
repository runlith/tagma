---
id: 01a1565d-7ddd-786f-818b-357e8b0d4d88
title: The diff tab names the project and checkout of a change made by a thread outside its project
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a15629-938d-75ac-9940-8039b85acc68
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ChangesBody.svelte
---
**Observation (2026-10-19).** A thread homed in runlith created the file `packages/domain/src/summary.ts` in the law-lab project's checkout. The diff tab beside it showed `summary.ts packages/domain/src` — the reader takes the file for a runlith file.

The Changes list already settles this part: a group outside the thread's project is signed with project and branch ([[74506236]]). The diff header still names only the path.

**What to think through.** A project label in the diff tab header when the file lies outside the thread's project, and aligning it with the group signature in the list.
