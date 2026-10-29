---
id: 01a12cce-f608-71a0-aa2d-5d3228ba4c77
title: An open merge lands through submit_work together with the merge index and the session's selected lines
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
---
The resolved merge index is the merge-commit's base, graph included; the session's selected lines layer on top with the usual separation of others' uncommitted lines. Editing lines keeps a regular file's mode from the index, while `whole` carries the working form of the file explicitly. Judgement takes the whole result against the first parent and against each parent from MERGE_HEAD: only a violation present in no parent counts as new — a conflict resolution or the session's edit ([[dd898a86]]). The final parents-and-index check, publication, and completion hold one index lane: a shift refuses. The intent record keeps the commit, the parents, and the source index; after an interruption, startup or the next submit_work picks up the index and clears the state, keeping the later staging. A completion failure is named in the receipt of the already-landed commit and leaves the intent open for recovery.

An open merge in the shared checkout belongs to whoever holds its changes — the paths the index changed against ORIG_HEAD, i.e. against HEAD at merge-open time.
- If a live peer holds even one of these paths, and the landing carries none of them, the merge session does not close. Its lines land beside it as an ordinary commit from HEAD, and MERGE_HEAD stays.
- If the landing carries a merge path it holds itself, it closes the merge. If only peers hold such a path — a `lines-held` refusal.
- If nobody holds the merge paths — e.g. the operator merged in a terminal — the session closes the merge.

Without this, another session's merge went into its commit with its subject.

When HEAD shifted under an open merge, `readMerge` does not take the index as is. Merge changes (index vs ORIG_HEAD) are layered three-way onto the current HEAD (`merge-tree`), and a path both sides changed refuses `tree-mid-merge`. Post-landing index pickup is best-effort. If it failed, the index holds the old form of that landing's paths, and a merge-commit assembled straight from the index would silently roll them back. Holder judgement goes in path portions and stops at the first portion where a peer turned up: a landing next to a large merge does not judge it whole.
