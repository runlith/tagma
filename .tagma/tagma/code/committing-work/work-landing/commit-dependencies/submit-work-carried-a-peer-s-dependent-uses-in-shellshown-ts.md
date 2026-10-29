---
id: 01a168b6-2e2f-7e85-a690-fd51ce40a5d6
title: submit_work carried a peer's dependent uses in shellShown.ts without their declarations and landed a commit that does not compile
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "e30a62b2a2:shellShown.ts uses `filenames` (lines 164–169) and `searchPaths` (184) from fix-tools' work, but their declarations, SearchOutput/ShellNames and printed() orchestration stayed in the working tree (+45/−10 still held by fix-tools); HEAD does not typecheck until a follow-up commit.",
    "command": "submit_work by fix-commands (01a168a8-7249-7f7b-ad52-481aff69302d) → commit e30a62b2a2 \"Parse shell argument roles before delivering file law\", with peer fix-tools (01a168a9-4174-7446-88eb-d88cf07b5d20) holding lines in packages/agent-tools/src/shellShown.ts",
    "expected": "Dependent peer lines land together with everything they depend on (declarations, bindings) or stay out entirely; the landed tree compiles as the working tree did."
  }
---
Filed from project `runlith`.

Within one file, not across files as in 03b72225. Both sessions' working tree passed agent-tools typecheck and tests; only the sliced commit tree was broken. Verified with `git show e30a62b2a2:packages/agent-tools/src/shellShown.ts | grep -n "filenames\|searchPaths"` — uses only, no declarations.