---
id: 01a113ff-0d62-74ec-ae7c-e91522a95947
title: "The HarnessTurns port splits into three tags by subject: turn journal, turn run, live stream"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/service/harnessTurns.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/turns.ts
---
## Now

`HarnessTurns` (`threads/contract/service/harnessTurns.ts`) is one service tag with 22 members over three subjects:

| Subject | Members |
| --- | --- |
| turn journal | `writes`, `journal`, `compaction`, `tool`, `prepare`, `switched`, `publish` |
| turn run | `began`, `end`, `alive`, `waiting`, `adopt`, `depart`, `resumeWaiting`, `spendable`, `spent` |
| live stream | `atCut`, `opened`, `delta`, `boundary`, `committed`, `closed` |

This violates [[2fcf2221|the service tag rule]]. Every consumer gets all 22 members: the driver, `sessions/switch.ts`, `contribution.ts`, tests. The signature never shows what it actually needs.

## Goal

- The port splits into three tags, each named for its subject and declared in `threads/contract/service`.
- One implementation in `threads/harness/turns.ts` may fill all three: the rule allows it. Composition binds each tag separately.
- Every consumer takes only the tags whose members it calls. After [[16a4c8ac|the owner-built driver assembly]] each of its parts holds only its subject in the constructor.
- Members move with no behavior change. A member needing one more subject first finds out who owns it instead of dragging a second tag along. Example — `end`: it places a copy for recap.

## Verification

The performer proves:

- the server typecheck passes;
- protocol and compaction system tests pass with assertions unchanged;
- no consumer gets a tag whose members it never calls.
