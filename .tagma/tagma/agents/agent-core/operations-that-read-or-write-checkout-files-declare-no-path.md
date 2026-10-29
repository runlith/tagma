---
id: 01a0cfcb-044a-7dc1-8d48-3d66cbb0cb9f
title: Operations that read or write checkout files declare no path in the workspace spelling, so a same-step edit can race them
ord: 169
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
**What.** Caller-named files are now declared ([[96f6c2f2]]). Operations that touch files in the checkout still declare nothing, or declare in another spelling:

- `strip_comments` reads and rewrites files under its path, with `subjects: () => []`;
- `import_output` writes its destination, and declares nothing;
- `submit_work` commits the tree and declares only `taking:` handles;
- `verify_block`, `run_doctor`, `anchor_block`, and update or edit with `checked`, read block sources and declare nothing;
- the worktree and checkout acts declare paths in absolute lexical spelling (`protocol/worktreeSubjects.ts`), which never overlaps the workspace tools' root-relative spelling.

**Why it matters.** A same-step `edit` followed by any of these runs side by side with it.
- A commit can land without the edit.
- A verify can stamp the bytes from before the edit.
- `strip_comments` can lose the edit.

**Where to start.** Declare the paths in the body's `reads` and spell them with `pathSubject` against `caller.workspace.root`, as `apps/tagma/server/src/operations/callerReads.ts` does for caller files. Source-reading acts find their paths through the graph, so those lookups need a `prepare`, with the cost for parked approvals that [[96f6c2f2]] describes.

The worktree acts' spelling is also what stored grants with bindings match. Changing it needs a decision on reading old grants.

**Done when.** Each of these declares the paths it reads or writes in the workspace spelling. A test proves that spelling equals a workspace write of the same path, like the one in `GraphTools.test.ts`.