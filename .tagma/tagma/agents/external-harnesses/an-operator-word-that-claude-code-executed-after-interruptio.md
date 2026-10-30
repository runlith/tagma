---
id: 01a15b99-425f-78e8-9cbb-8119bcff25ca
title: "An operator word that Claude Code executed after interruption vanishes from the feed: the runner does not tell the driver that an unwithdrawn word was taken"
ord: 88
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b88-e429-73d6-a7bb-5e1330521d6e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15ba6-6aca-7c3d-990f-13471510fceb
  - kind: relates
    to: 01a15b89-5c49-706e-add8-3127383fb4ee
sources:
  - kind: file
    ref: packages/adapter-anthropic/src/runner/turn.ts
---
The operator sent a word mid-turn (Enter) and interrupted the turn (Escape) — in the native thread this is "interrupt and send immediately". Thread `01a15b76-79b6-7e33-b1b6-7daef490c6d3`, October 20: Claude Code queued the word at 23:12:57, interrupted the turn at 23:13:00.069 and executed the word under a new uuid at 23:13:00.085. The agent answered it, the answer is recorded in run `01a15b96-a650-79f8-840d-4b50ab2c5bb1`, and the run ended `completed`. The runner answered `_tagma/steer` `…:10` with refusal `-32603 the turn was cancelled, but Claude Code may still run these words`. The driver reads this refusal as an unconfirmed word and writes it nowhere. When Claude Code later takes such a word (`Turn.took` → `survivors`), the runner does not tell the driver. The result: the feed holds an answer to a message that is not there. Do: a word Claude Code executed stands in the feed and is confirmed in the inbox just as on native, where words after Escape open the next turn.
