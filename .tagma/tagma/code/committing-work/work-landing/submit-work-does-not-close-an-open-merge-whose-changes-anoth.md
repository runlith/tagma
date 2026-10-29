---
id: 01a131de-0c01-74f8-8566-f80ee832657e
title: submit_work does not close an open merge whose changes another live session holds
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a131d8-d936-76c6-a57e-15ebc3756eae",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a131db-8eda-76a5-9786-19c23ef926c5
---
Right now `submit_work` closes any open merge in the checkout, even one another session opened. Its merge went into someone else's commit with someone else's subject (case bd3ade7255).

Do:
- **Whose merge.** Its holders determine it — the holders of the paths the merge changed in the index against HEAD.
  - If among the holders are the session itself or a session from `taking`, or there are no holders at all — the merge closes, as now.
  - If only live peers hold these paths — the merge is someone else's.
- **Another's merge** stays open, conflicts included. The session's lines land beside it as an ordinary commit from HEAD: the index untouched, while publication moves the branch with MERGE_HEAD standing.
- **Intersection.** If the session's path also changes this merge, a `lines-held` refusal names the merge's holder.

Start: `change-record/prepared/change.ts` (`mergeFor`), `landing/land/commit.ts` (`publish`), `platform/git/publish.ts` (`advance`).

Done when the itest in `submitMerge.itest.ts` checks:
- the session's commit next to another's merge — one parent, MERGE_HEAD intact;
- the holder's later submit closes the merge without losing the first session's lines;
- a `lines-held` refusal on intersecting paths.
