---
id: 01a17d65-b4b1-792b-9821-f7711d4b6277
title: "A background-left command's end arrives as a command-ending notice: the feed draws it from structure, the model text builds from the same"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17d66-36cb-787f-94bb-7c12cb422fb7",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/commandEndings.ts
---
A background-left command's end arrived in the thread as one model text (`commandEndings.ts`, `endingText`), with no `notice`. The feed never parses text (note 00d5da5d), so it showed the whole of it, and assembled the row from the type name: "Command result".

Ending delivery puts a `command-ending`-kind `notice` into the signal (`AgentCommandEnding` in `packages/agent/src/agent/contracts.ts`): run and incarnation, the command line (`commandLine ?? label`), the outcome (`completed`, `stopped` — the run's owner ended it, `expired` — its life ran out, `unknown` — no decision or the end unreadable), the exit (code or signal) and the output tail (`null` — unread, `''` — no output). The model text builds from the same notice and stays what the model reads now. The feed and the waiting dock draw the end from structure.
