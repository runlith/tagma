---
id: 01a15eeb-6b48-7ca8-9c93-24db7deebf81
title: "Esc and Enter proof: a shared transport conformance set and Claude Code interruption measurements"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/threads
  - kind: dir
    ref: packages/agent/src/thread/conformance
---
One "Esc and Enter" conformance set is part of the transport contract: every transport passes it, including future ones. Without measurements of the real Claude Code the "Esc always at once" promise on ACP is unproven, so measurements are part of the proof.

## Set

The set sits beside the transport's other sets in `packages/agent/src/thread/conformance` (`transport.ts`, `runLog/stops.ts`). ACP and the terminal run it in `apps/tagma/server/src/composition/testing/threads`: ACP with a scripted agent and with the Claude runner on a fake `Channel`, the terminal with a fake CLI in a PTY. Each file fits its test-layer budget.

**Esc — states:**
- at turn opening;
- during a model stream (thinking and text);
- during a Tagma tool call;
- during a vendor tool call;
- on an open question or approval;
- during compaction, on a turn and at the end;
- during vendor session reopening;
- with a mid-turn word in flight: handed over, no echo;
- right after the word's echo;
- in a race with the turn's natural end;
- with no agent process connection;
- after a server restart;
- repeated Esc.

**Esc — checks:**
- the turn ends `aborted` with `stoppedBy`;
- after the receipt nothing is written into the turn journal, and the agent starts no new vendor turn. One exception: a record of an operator word's fate handed to that turn before the stop. If the CLI read such a word after the interruption, it stands read behind that turn: Tagma's journal then matches the vendor session history, and the word does not leave twice;
- the stop answer is one of three (`stopped`, `requested`, `nothing-running`);
- the stop-to-turn-end time is measured and printed into the set report, and the verdict rests on the fact.

**Enter — states:** on a going turn, in a race with the turn end, in a race with the start, during a stop, during session reopening, on archive.

**Enter — check:** the word delivered exactly once and in press order.

## Claude Code measurements

Claude Code interruption (`interrupt()` on the SDK) is measured on the `claude` version the runner works with, in these states:
- thinking;
- text;
- Tagma MCP call;
- `WebFetch` with an open hook;
- `/compact`;
- a non-empty word queue (`still_queued`);
- a merged message after interrupt.

For each, the time to `result` and what Claude Code did with the words is recorded. The record is #research under module [[287a4906]]; when the `claude` version changes, the measurements repeat. Earlier measurements are [[b05a4728]] and [[332f3ece]].
