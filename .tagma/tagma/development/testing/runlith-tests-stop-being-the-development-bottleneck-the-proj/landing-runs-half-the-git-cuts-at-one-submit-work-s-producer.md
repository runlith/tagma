---
id: 01a16e46-5e56-7485-bef9-e4c4947dbe68
title: "Landing runs half the git: cuts at one submit_work's producers"
ord: 28
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc89-7007-819b-ee8182c1a18f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
One `submit_work` starts about 40 git processes: the landing itself ~25, Holdings judgements ~15. Goal — roughly half as many, with cuts at producers (the caller's `commonDir` config-store site, judge batches on one landing's paths, CommitTrees, the publication sequence, ConfigVersion of steps and judgement), at unchanged git behavior and refusals. Count — a git-site preload before and after on the same scenarios; one review round.

**Total (one sample on the operator's machine, nativeLanding probe through execution host, 4 rounds, peer and caller editing one file):** git per submit without steps ~65 → ~56, with one format step ~80 → ~73. That count includes neighbors' cuts: FreshnessGate (a1e80d799f, ~10 → 3) and Holdings, still in flight in 83fcc59c.
- 29c0b30200 — the git kit's `Layout` reads `--git-common-dir` with the same `rev-parse`; `commonDir` travels through ShapeAsk, PreparedSubject, Landing, and TreeSubject, so commit-step and judgement `Configs.read` no longer seeks the config store with its own git.
- 4e9ddd9249 → rolled back cbc6c091d3: the "steps name files that returned to base instead of `diff-tree base..shaped`" cut is wrong. The format command receives the private index's `GIT_INDEX_FILE` and can stage a file outside its operands, which only a tree diff can see. Besides, `shasOf` reduces every mode but 100755 to 100644, so a symlink with the same blob would look returned to base.

Dropped: the `core.excludesFile` stamp cache (the commit tree sees system and global config, the stamp never proves that) and merging diff-index into index sync (unread-semantics risk for one git).

The landing's remainder is one git per site: publication (`rev-parse` + `update-ref`), hooks, sync `reset`, CommitTrees `read-tree`/`clean`/`check-ignore`. The two `ls-tree` in `submitWork.indexDue` go only if preparation passes the read tree records onward. That is `change-record/prepared/tree.ts`, now with x-record-fix.
