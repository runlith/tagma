---
id: 01a12cce-f608-71a0-aa2d-5d3228ba4c77
title: An open merge lands through submit_work with its resolved index and the selected whole files
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12cc6-5156-7303-a8ac-4ae5d8ea5569
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/change.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/subject.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/commit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/conclusion.ts
  - kind: symbol
    ref: apps/tagma/server/src/landing/land/submit.ts
    symbol: submitWork
---
The resolved merge index is the merge commit's base, graph included; the selected whole files are laid over it as they stand on disk. Judgement takes the whole result against the first parent and against each parent from MERGE_HEAD: only a violation present in no parent counts as new — a conflict resolution or the caller's edit ([[dd898a86]]). The final parents-and-index check, publication, and completion hold one index lane: a shift refuses. The intent record keeps the commit, the parents, and the source index; after an interruption, startup or the next submit_work picks up the index and clears the state, keeping the later staging. A completion failure is named in the receipt of the already-landed commit and leaves the intent open for recovery.

A merge in the shared checkout belongs to no writer. It concludes with the first landing that carries a path the merge changed — the paths the index changed against ORIG_HEAD, i.e. against HEAD at merge-open time. A landing that carries none of them lands beside it as an ordinary commit from HEAD, and MERGE_HEAD stays. A bare call with nothing selected answers `nothing` even while a resolved merge stands open. Unresolved conflicts refuse `tree-mid-merge` with their paths; a cherry-pick, revert, rebase or am in progress must conclude first.

Without the rule, a merge opened by one session went into another session's commit with its subject.

A landing that concludes a merge brings the merged branches' graph twins into the checkout's graph before it answers — a team project's stealth layer included — and names that sync in `graph`; a twin merge that conflicts waits in graph recovery. Left to the watcher, the twin followed only on the layer's next background refresh, its backoff included, while the team tree already held the merged files: a block the base moved from stealth to team stood twice and the checkout's graph refused `duplicate-identity`.

When HEAD shifted under an open merge, `readMerge` does not take the index as is. Merge changes (index vs ORIG_HEAD) are layered three-way onto the current HEAD (`merge-tree`), and a path both sides changed refuses `tree-mid-merge`. Post-landing index pickup is best-effort. If it failed, the index holds the old form of that landing's paths, and a merge commit assembled straight from the index would silently roll them back.
