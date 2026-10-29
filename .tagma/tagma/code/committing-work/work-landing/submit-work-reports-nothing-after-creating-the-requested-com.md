---
id: 01a0e848-0df3-734a-9efe-f8fcb3cc0014
title: submit_work reports nothing after creating the requested commit and leaves inverse staging
ord: 87
tags: ["reflection"]
fields:
  {
    "actual": "The call returned “nothing to commit — this session holds nothing the branch does not already carry”. Git then showed new commit 24bf3ae656 with exactly that subject and all eight requested files (358 insertions, 10 deletions). read_changes reports no held body.ts lines. Git status shows MM on the five edited files and staged D plus untracked copies of manifest.ts and platform.ts, indicating the old index survived as inverses of the new HEAD. No index cleanup was attempted.",
    "command": "submit_work(subject=\"platform K0: type declarations and manifest contributions\", paths=[the eight platform manifest contract paths])",
    "expected": "Return landed with the new commit and leave unrelated index entries unchanged without staging inverses of the landed change."
  }
---
Filed from project `runlith`.

This is tool-result/index bookkeeping friction in the shared restructure worktree, not a failure of the manifest implementation. The requested eight files were ids.ts, operation.ts, setting.ts, section.ts, body.ts, manifest.ts, manifest.test.ts and platform.ts under apps/tagma/server/src/platform. The runtime.ts substitution was intentionally outside this invocation.