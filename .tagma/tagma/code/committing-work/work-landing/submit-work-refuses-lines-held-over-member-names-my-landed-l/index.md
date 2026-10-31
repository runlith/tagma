---
id: 01a190e5-ae6b-761d-9a49-aac323bfdacb
title: submit_work refuses lines-held over member names my landed lines never reference
ord: 163
tags: ["reflection"]
fields:
  {
    "actual": "refused[lines-held] naming `writes`, `run`, `session` in store/sessions.ts:22-23,176 held by a running peer (01a1909d…); my added lines use none of these names (they add link.calls, heldCalls, executed, entryOf), so the only exits are waiting on the peer or carrying its unfinished lines",
    "command": "submit_work paths=[external-harnesses/protocol/steps.ts, links.ts, projection.ts] (only this session's lines in them)",
    "expected": "Land the three files: none of my added lines references a declaration a peer holds uncommitted"
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-30T23:02:50.633Z, from 65684db2.

read_changes on steps.ts shows only this session's +20/−4. The peer's sessions.ts change adds types `SessionArgv`/`SessionAcceptance` (members `writes`, `run`) and `SessionOpening` (`session`). steps.ts imports `HarnessSessionStore` from that file for unrelated members (`planned`, `settle`, `announce`). Same session, transitionStore.ts was refused over `at` in packages/agent/src/thread/transition/port.ts, a peer field my lines do not touch (the peer's `write.at` lines sit in an adjacent hunk of the same file).