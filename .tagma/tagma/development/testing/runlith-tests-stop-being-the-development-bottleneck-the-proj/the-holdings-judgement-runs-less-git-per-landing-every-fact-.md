---
id: 01a16e4a-4793-72ac-b7a5-84fa83fcc59c
title: "The Holdings judgement runs less git per landing: every fact once per judgement batch, what the same act read reused"
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dfb-d3b1-7a0c-8a44-11413b9da093",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
sources:
  - kind: dir
    ref: apps/tagma/server/src/change-record/holdings
---
One `submit_work` starts ~15 git only in Holdings judgements: `status` by paths, HEAD `ls-tree` (`headsAt`), `check-attr` and `config --get core.autocrlf` (`conversionsAt`), sometimes `check-ignore`. Goal — every fact once per judgement batch, and whatever the same act already read reused at the producer. The `core.autocrlf` cache must stay provably fresh against global and system config and their includes. Count — a git-site preload on the same scenarios before and after; one review round. The rest of the landing (config store, CommitTrees, publication, commit steps) is cut by [[947dbe68]].
