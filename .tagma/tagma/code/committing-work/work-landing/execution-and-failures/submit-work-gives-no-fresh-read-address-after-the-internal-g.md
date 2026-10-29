---
id: 01a12cc1-a305-7286-81b3-641feebf3876
title: submit_work gives no fresh-read address after the internal git's terminal-stale-authority
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "Nothing committed: git ran and how it ended could not be read — terminal-stale-authority. The refusal demands read the command again but carries no execution/incarnation for read_command. The check is named: git -C /opt/workspaces/runlith rev-parse --git-path MERGE_HEAD --git-path CHERRY_PICK_HEAD --git-path REVERT_HEAD --git-path rebase-merge --git-path rebase-apply. Cost: a separate read instead of one submit_work.",
    "command": "submit_work({checkout:\"/opt/workspaces/runlith\",subject:\"Preserve authorship when reapplying an observed file\",paths:[\"apps/tagma/server/src/change-record/lines/folding.ts\",\"apps/tagma/server/src/change-record/lines/fold.contract.test.ts\",\"apps/tagma/server/src/native-harness/voice/sessionTools.ts\"]})",
    "expected": "The act commits its own lines or returns the command address and a workable way to refresh the read when authority changes."
  }
---
Matched with fix e3d3ce1d92: `openOperation` runs the internal git through `admittedGit`, which carries `admittedWatch.Unwatched.said` into `GitEndingUnreadable`. In the current `admittedWatch`, wait and console refusals carry execution and incarnation; `GitEndingUnreadable`, `OwnGitFailed`, and the landing answer keep that address before the command text. The same commit removes the recheck race with `rootUse` release described in the [[536ffde9|authority fix task]]. Per the launching agent, the running server still uses the build made before this commit; applying the fix to it remains the operator's action.
