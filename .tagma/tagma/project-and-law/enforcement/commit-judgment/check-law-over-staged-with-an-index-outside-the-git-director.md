---
id: 01a13651-e5ed-791e-83f4-4885998580b7
title: check_law over staged with an index outside the git directory answers "nothing to check" instead of its refusal
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "\"nothing to check — this session holds nothing the branch does not already carry (HEAD )\" with \"no violation\": the failure is rendered as an empty success with a blank HEAD; the same index placed under .git/ was judged normally. Cost: one misleading clean answer that reads as proof, plus a diagnosis through the server source.",
    "command": "check_law {over: \"staged\", root: \"/opt/workspaces/runlith\", index: \"~/.tagma/scratch/<thread>/assets.index\"} — a private index holding HEAD plus five new files",
    "expected": "A refusal naming why the index cannot be judged (stagedTree fails OwnGitFailed \"… is not an index of this checkout's git directory\"), or a judgement of the five files"
  }
---
Filed from project `runlith`.

The guard is `stagedTree` in apps/tagma/server/src/enforcement/judging/trees.ts (index must lie within the git dir or common dir). The voice line comes from apps/tagma/server/src/enforcement/voice.ts:142, which prints the change-mode "nothing to check" wording. A caller relying on check_law staged as proof would take the blank answer for a pass.