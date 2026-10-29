---
id: 01a12c9f-b2ce-7ab2-85aa-44fb872121e7
title: "Renaming a block title moves its file onto another block's file: four blocks destroyed, two left duplicated with stale text"
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "The new slug landed on paths already held by other blocks and overwrote them. Lost entirely (read_block not-found): 55b5437b (UI-tokens #rule with its enforcement document — its file `tagma-55b5437b.md` ended holding 35be02f0 under `tagma-35be02f0.md`), af373f07 (#module plugin secrets, `tagma/env/index.md`), f1844d71 (note, `tagma/env/env.md`), 97fdddaf4476 (note `tagma/cli-tagma/claude-acp-tagma.md`, overwritten by 92391518). Duplicated: 8162ede6 in `tagma-8162ede6.md` and a later `tagma.md` carrying stale text, which the server now delivers as the law; 92391518 in `claude-acp-tagma.md` and another file. update_block on 6cc306ce refused ENOTEMPTY twice (0fa91a70).",
    "command": "update_block / edit title on ~29 runlith blocks by agents rename-a and rename-b (e.g. 35be02f0, 92391518, 05042d40), 2026-10-11 ~20:05–20:16Z",
    "expected": "A title change renames the block's file to a free slug; no other block's file is touched, every block keeps exactly one file"
  }
---
Filed from project `runlith`.

Losses all arrive in graph commit 1b528f3d26 (22:10:16 +0200); the stale 8162ede6 copy in dfc23ddad2 (22:16:25). Measured by comparing frontmatter ids at d4d319297a (before the rename) with the working tree: 4 ids missing, 2 new duplicate ids. The intact versions are in git at d4d319297a. Renames stopped.