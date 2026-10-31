---
id: 01a14cf8-6247-7746-9036-752abccb479c
title: "Parity: the turn end writes the core close — interruption by the native rule, provider-classed failure, one model-outcome judge, aside copy and recap rule"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01f6-7d00-af4d-7f2b2b1aecb7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14cba-e095-7bcb-bb6f-608245d13bf3
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/naming/excerpt.ts
  - kind: file
    ref: apps/tagma/server/src/threads/recap/questions.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/failure.ts
  - kind: file
    ref: packages/agent/src/agent/finish.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunReports.ts
  - kind: file
    ref: packages/agent/src/thread/ThreadFailure.ts
---
Implement [[45d13bf3]]: the interruption row only from the core close (`closingOf` goes away), `TransportFailure` inside `ThreadFailureDiagnostics`, the shared `unsuccessfulFinish` judge, the aside copy at any outcome and from the turn's first `measured`, the [[eba592c4]] recap rule with the cache mark in `/recap`. The copy from the first request waits for `measured` from [[424c0878]]. Proof — the part criteria, commit.

## Outcome

Commits: 30a24a9cb5, f2dd43e319, 7ae9e4f973, 323cd7252a, 6687f6d771, b03b38a918, 049c976574; other sessions landed this work's rows too: `protocol/journal.ts` — afeccf470e, the first parity scenarios — e34a0cec72.

Proven by the parity suite (native versus scripted `acp`): Stop mid-text — a row; Stop with steer — "Interrupted to deliver 1 steer"; Stop mid-tool with no text — no row; a parent stop mid-text; cancellation by the vendor itself mid-text — as a reader Esc on native. The Stop-with-withdraw matrix — a journal with no record. Terminal: the Cursor Stop hook `aborted` ends the run `aborted` with no interruption record (`terminalRuns.itest.ts`).

Not proven by test:
- a model move between roads mid-turn — no record by construction (stop on the step boundary), no separate scenario;
- Esc in the Claude-terminal TUI (via `terminal/watch.ts`) — only the Cursor Stop hook is covered;
- a stop by an interrupt task (`by: agent`) — covered by a parent stop on the same `stop` path with `marker`;
- on `acp` a run with steer ends with `ending: null` in the snapshot, because the successor opens before the read; the row matches, the end status does not;
- `RunExecution.halt` waiting for a step boundary (`awaitSettled`) on an adapter run still closes it at once, tail-less.
