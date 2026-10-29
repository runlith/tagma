---
id: 01a0f204-1993-70d4-9ed9-3a6f13a99e09
title: Commit gate hook crashes in `tagma check` and refuses every agent commit while check_rules answers clean
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "`tagma check` throws `undefined is not an object (evaluating 'checked.rules.flatMap')`, the hook exits 1, the rebase stops on pick 6223f229a1; reproduced three times, the local release cannot be rebased onto origin/release and pushed",
    "command": "git rebase origin/release in another project's checkout (prepare-commit-msg tagma gate → `bun …/bin/cli/main.js check`)",
    "expected": "`tagma check` prints `clean` (check_rules over staged answers status ok, rules [], refuses false) and the rebase proceeds"
  }
---
The CLI reads `checked.rules` from an answer shape that no longer carries it where the door answer does (`rules: []`). Blocks every agent commit, rebase and cherry-pick in any checkout the gate hook is installed in.