---
id: 01a14d99-12a5-7aa6-ba53-d4a90aee0af9
title: ACP turn spend arriving after the core finished the run never reaches thread_run.usage
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01c7-7c57-8276-9b8a4d9df8f3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14cf8-61ad-7951-8d02-f76495efcfc2
sources:
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunReports.ts
---
`RunReports.measured` answers `settled` and writes nothing once the run is no longer `running`. `RunReports.ended` adds `rest` and writes `cost` for `running` only too. The core can finish an `acp` run before `TurnEnded` or the last `usage_update` with `tagma/measured` arrives: a stop with grace, a server restart with reaper, a session death while frames are still in flight. Then the request the vendor already charged for, plus the rest of the turn (subagents, compression inside the turn), drop out of the run spend and the tree budget. Native has none of this: the request lands in the recorder before the run ends.

Why it was not fixed in place: the `running` check is the only protection against double counting on `ended` repeat after adopt, and `ended` carries no evidence. The fix needs idempotent landing of late spend: `measured` by its own evidence (the vendor message id), `ended` by turn evidence. It also needs to decide what a spend reader sees on a finished run that keeps growing (run end, budget, cards).

Done in 3d884bd53b and 5b9bb70467, contract — [[c2ddbc0a]]. `writeCost` of the run port is replaced with `charge` (any status), idempotence held by `chargeKey`, which survives the end of the run; `ended` lands the remainder under a permanent mark until `finish`. Proven: conformance `lateSpend.ts` on memory and SQLite (late request, its repeat, `ended` repeat, a request before the end and its repeat after), the parity-suite scenario "Stop with an open question, then agent spend" (963 = 960 + 3), the full `parity.stest.ts` 74/0, memory storagePort 132/0. Two reviewers' review; the confirmed P1 (a repeat of the same request after the end counted twice) fixed in the second commit. Not done: turn activity does not get a late request if the turn end arrived as a separate earlier step; `rest` and `cost` of one turn share one mark (separate delivery would have lost the second half — no current caller has it); a late `measured` with the same id but different spend answers replay, not a refusal.

Start from `RunReports.ended`/`measured` and `ProtocolJournal.closed`. Proof: the parity-suite scenario (scripted `acp`) — Esc with a late answer to the prompt carrying `usage`, and a late `usage_update`; the run spend equals the sum of requests plus remainder, and a repeat of the same frame after adopt does not double it.
