---
id: 01a1374f-cdfc-7d00-897d-1414c93c1394
title: The world-held refusal of --move names an execution-host shutdown that fails as printed
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "`execution-host shutdown` declares `--operation <name>` without a default (executions/cli/host.ts operationName, shutdownCommand), so the printed line stops on a missing flag. It also names `move.from.command` (`tagma`), while a channel build writes the standing launcher as `tagma-dev` (launcherPath of standingChannel); `tagma` exists only where a pre-channel build left it.",
    "command": "bun run tagma:build --move refusing world-held (installation/move/move.ts heldRefusal), unblock line `${move.from.command} execution-host shutdown`",
    "expected": "Every unblock line runs as written, with the command the machine actually has."
  }
---
Filed from outside every registered project.

The same line went into the channel agent's step-by-step plan for the operator (thread 01a12660, step 3: `tagma execution-host shutdown`).