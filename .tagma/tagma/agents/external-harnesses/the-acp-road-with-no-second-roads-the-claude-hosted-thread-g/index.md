---
id: 01a113ff-0d62-74ec-ae7c-e91101dc1899
title: "The ACP road with no second roads: the Claude hosted thread goes to Tagma's native owners, the driver is owner-assembled, the runner holds the documented SDK contract"
ord: 46
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/protocol
  - kind: dir
    ref: packages/adapter-anthropic/src/runner
  - kind: file
    ref: packages/agent/src/thread/run/ThreadHosting.ts
---
## Why

The ACP road rated on 2026-10-07: architecture 5–6, reliability 7, code quality 6 out of 10. The foundation holds: every protocol step is recorded to the byte, a turn survives a server restart ([[e47bd3fc|driver step write]]). Three things drag the rating down:

- part of what Tagma owns travels a second road beside the native one on a Claude `acp` thread;
- inside the driver the same task is solved differently in every feature;
- the runner is pinned to the exact `claude` version, and only live tests verify its behavior.

This spec describes the target state where all three axes rate 10. Thread behavior for the operator changes only where a second road works now; in everything else this is pure refactoring.

## Principle

Whatever Tagma can do itself, the hosted thread gets from the same owner as the native thread. The ACP protocol carries only what belongs to the vendor: its agent's turn, its own tools and its questions about them (Devin). One fact is written by one owner, and one act has one road.

## Double roads and where each ends

| What | Now | Goal | Where |
| --- | --- | --- | --- |
| Tagma tool confirmation | the `ask` verdict leaves for the runner, which asks ACP `session/request_permission`, the driver parks a “choice” question in the facet | the native `thread.tool.confirm` question from `ThreadHosting`, the same as on a native run | [[7c54d3ed|hosted thread]] |
| `ask_user` question | a native journal record and its trimmed mirror in `facet.question` | only the native record | [[7c54d3ed|hosted thread]] |
| Run awaiting | the driver sets the run stage from the facet mirror | the kernel holds the open-question fact (`ThreadHosting`), the ACP driver writes the stage on its signal, sealing the turn's live stream; contract — [[fb39e560|questions and confirmations]] | [[7c54d3ed|hosted thread]] |
| New-session history | the driver computes a recap, the runner reads the journal, the driver drops the recap on `history` | on a hosted session only the runner's `read_hosted_history` | [[7c54d3ed|hosted thread]] |
| Extension request id | guessed as `${incarnation}:${counter + 1}` in four places | the client machine answers with the issued id | [[16a4c8ac|driver]] |
| Extension answer | every feature finds its answer in step events its own way | one dispatch by extension declaration | [[16a4c8ac|driver]] |
| State waiting | five waiter maps and timer polling on stop | one per-thread signal | [[16a4c8ac|driver]] |
| Protocol row change | every operation has two branches: with and without a live link | one road | [[16a4c8ac|driver]] |
| Claude prompt snapshot | an internal CLI flag pinned to the exact version | the documented SDK `snapshot: false` | [[4acce69d|runner]] |
| Operator words mid-turn | every word is a `turn` record, handed to the agent at once and gone from waiting; Tab (`queue`) is the same steer; cancel goes to the native harness | Enter is a steer (the reader's `signal`), Tab a follow-up (`turn`) via the same kernel constructors; the steer waits in the badge until the agent's echo, is cancelled by recall at the runner; a read steer is the native `signal` record | [[ecb9d0d6|mid-turn words]] |
| Compaction | an “on-step” request runs after the turn; no summarizer choice: `read_compaction_choices` refuses, `/compact` is placed with no menu; mid-turn Claude Code itself compacts at its own threshold | Enter compacts at the nearest step boundary inside the turn, Tab after the turn; the summarizer menu, chain and rule are native, a foreign model retells the Tagma journal and opens a new session; Tagma alone picks the moment | [[8cbd05a4|compaction]] |

## What 10 means on each axis

**Architecture:**

- no Tagma concern travels a second road on an `acp` thread ([[7c54d3ed|hosted thread]]);
- every operator gesture — Enter, Tab, word cancel, Esc — gives an `acp` thread the same observable state as a native one: the same inbox records, the same `pendingInput` rows, the same journal record;
- every compaction gesture — `/compact` with Enter or Tab, model choice, threshold — gives an `acp` thread the same as a native one; a foreign model picked mid-turn compacts after the turn ([[8cbd05a4|compaction]]);
- every driver part holds one subject, dependencies run only downward, no part takes a closure onto a neighbor or calls the facade ([[16a4c8ac|driver]]);
- the port between `threads` and `external-harnesses` is split by subject ([[22a95947|turn port]]);
- the undocumented-SDK-API dependency sits in one runner adapter ([[4acce69d|runner]]).

**Reliability:**

- the operator's call decision is journaled and survives both server restart and runner process death ([[7c54d3ed|hosted thread]]);
- every driver `_tagma/*` road is verified deterministically, including a server restart mid-request ([[16a4c8ac|driver]]);
- the driver awaits events instead of polling on a timer ([[16a4c8ac|driver]]);
- the runner never depends on the installed `claude`'s exact version ([[4acce69d|runner]]).

**Code quality:**

- one mechanism per task: request id, extension answer, wait, row change ([[16a4c8ac|driver]]);
- files split by subject, none stands at the 650-line ceiling;
- tests guard owner contracts and never depend on the network; live tests against `claude` are smoke only ([[16a4c8ac|driver]], [[4acce69d|runner]]);
- every note about touched code is rewritten in the same change as the code.

## Order

[[7c54d3ed]] → [[16a4c8ac]] → [[22a95947]]; [[4acce69d]] — after [[7c54d3ed]], parallel with [[16a4c8ac]]. [[8cbd05a4]] — after [[16a4c8ac]] and [[4acce69d]]: compaction builds on their owners.

[[7c54d3ed|Hosted thread]] goes first: it deletes consent and the question mirror from the driver, so the driver is rebuilt over less code. Runner and driver share no files.

## Tie-in with open work

- [[adb9cd5b|Transport spec]] already requires the server — not `request_permission` — to judge Tagma tool calls on Claude (decisions 2 and 5); `request_permission` on Claude stays a vendor question — `WebFetch`. Consent via ACP is the code's deviation from it, and [[7c54d3ed|hosted thread]] deletes it.
- Decision 2 of the same spec now requires the documented `snapshot: false` instead of the CLI flag pinned to the `claude` version.
- [[d52b17a2|Devin fork and rewind]] stays a separate task.

out:
- the research under the module describes vendor surfaces for [[adb9cd5b|the transport spec]]. The refactoring changes only one vendor decision — the prompt snapshot, grounded in [[6c4c410f|the SDK-under-Bun probe]] and SDK 0.3.292 types;
- the terminal transport and its search indexing ([[8c07bcb3|idea]]) are untouched;
- Cursor, ACP v2 and the Devin transport never change, apart from driver code shared with Claude.
