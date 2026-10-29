---
id: 01a0d037-444f-799c-bc50-8ac64c006546
title: A child that finishes its delegated work in a run another agent woke reports it to nobody
ord: 151
tags: ["reflection"]
fields:
  {
    "actual": "Only the child's first run, the one the spawn task opened, reported to the parent. The run that committed c22990ea65 and finished task 52d67932 was opened by a peer's message, owed nobody a report, and its final answer stayed in the child's own log; the operator had to wake the parent by hand",
    "command": "spawn_agent starts a builder; later runs of that builder are woken by its reviewers' reports and by peers' send_message; in one of those runs it lands the commit and finishes the task",
    "expected": "The parent hears that its delegated work is done, whichever of the child's runs did it"
  }
---
Filed from project `runlith`.

Measured on 2026-09-23 on thread `01a0cfc0-4519-73aa-b2c4-c0c1d73526f5` (`build-server-lanes`, parent `01a0cf08-d6c6-74b9-8c88-65630f1c3f68`): 15 runs. Run `01a0cfc0-4598` (19:31–20:10) was opened by the spawn task and its report reached the parent at 20:10. The other 14 were opened by envelopes — reviewer reports, peer messages and the parent's own message — and `ThreadEnvelopes.completeRun` answers only `task` items delivered to the settling run. Run `01a0d01b-3b51` (21:10–21:14) was woken by `build-host-lanes`' message, and its final answer "Task 52d67932 is landed in commit c22990ea65…" reached no one. `build-host-lanes` closed task 930e0cfb the same way. The same hole silences a woken run that fails or is cut.

Both collaboration voices promise delivery without condition: the child's birth header and its collaboration section say "your final message is delivered to it as a report", and the parent's says "an agent's final answer arrives to you automatically". The child therefore wrote its landing report as a final message and believed it sent. The same road as [[bcbc65ec]], met from the delegating parent's side rather than the message sender's.