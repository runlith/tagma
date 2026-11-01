---
id: 01a14110-f6eb-7d7d-8514-800277e2962b
title: A landing under which the branch moved on others' paths rebases the ready tree onto the new HEAD and judges it again instead of building the commit from scratch
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/rebase.ts
  - kind: symbol
    ref: apps/tagma/server/src/landing/land/commit.ts
    symbol: commitOwn
---
Building a commit (selecting lines, commit steps, assembling the tree) in the busy shared checkout takes minutes, while HEAD moves there more often: three full attempts in a row lost to other landings and ended in `landing-busy`.

If HEAD moved between assembly and publication, `PreparedChanges.rebase` lays the same change onto the new HEAD: the pre-steps tree and the post-steps tree are HEAD plus the change's path records. The rules judge the rebased tree again against the new HEAD (cheaper than assembly, and only a violation against what will become the parent counts as new); hooks and commit too. The number of rebases is limited only by the call ceiling; full assemblies stay at three.

Rebasing is impossible, and the landing assembles the commit from scratch, when:
- the shift touched a change path, or a path nested in it or containing it: the session's lines were judged against the old version of the file;
- the shift touched a path carrying this commit's format commands (`declaration` of the ready tree): `tagma.config.ts`, a file it imports, or a path the resolver looked for and missed. The commit is shaped by the commands of its own version;
- the landing closes a merge or runs next to an open merge;
- the ready tree regenerated derived outputs: the new HEAD may change their inputs, so they must be regenerated again;
- the publication was lost by an attempt whose hooks edited the tree: the edits already reached the working files as the session's lines, and the rebased old tree would not have committed them.

While the landing runs, it names its step via `CallStage`: `wait_call` and `read_calls` answer it in `detail`.
