---
id: 01a14cf8-62c0-75f1-8452-7c20da3af7a3
title: "Parity: turn launch brings the Claude session on ACP to the core — live model and effort change, rewind and withdraw with no process start"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01b6-73d1-ab67-0e20a204ca15",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14cba-e095-7bcb-bb6f-60854010a731
  - kind: implements
    to: 01a14cba-e095-7bcb-bb6f-608666a5c66e
---
Implement [[4010a731]] and [[66a5c66e]] under one owner: both change the turn launch at the ACP adapter (`Configure` from `configured { model, effort }` and the session cut by the `protocol_turn` diff against the journal). The `thread-running` refusal and `release` in model change, the rewind reserve, `attendance.ready` and the `row.rewind` checks go away. Proof — the criteria of both parts, including the crash windows, commit.

## Outcome

Code: a1d677743f, d01e2bdfc8; the core part (`JournalRuns`, `TransportHistory` without rewind/rewound/release) landed in c6d5e86. Proven by the `protocolConfigure` system tests (change mid-turn, restart, same effort without repeat, normalizing agent, empty choice → catalog default, option refusal) and `protocolCut` (crash windows, composition, restore with a cut in flight, cut refusal), `protocolStops`, `protocolMethods`.

Not proven:
- the parity suite via `set_thread_model` on native and `acp`, and a separate single-effort change mid-turn (the test writes the choice into the row directly);
- `Configure` on Devin at launch was not observed;
- the `aligned_launch` migration was trialled on row samples, without a test over a filled database;
- the "durable down to bytes" windows for `Configure` and `session/new` are not deterministically reproduced;
- restore after an executed cut (the `reset` branch) is covered only through a cut in flight.
