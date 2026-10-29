---
id: 01a116c7-b3ce-7a38-87dc-92d0ecb9d0d6
title: "Operator words mid-turn on ACP flow like on a native thread: Enter is a steer until the agent's echo, Tab a follow-up in its own turn, cancel recalls the handed word"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a113b6-e688-7d52-aa41-ac2f488d9c79",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a113ff-0d62-74ec-ae7c-e91101dc1899
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/inputs.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/methods/steer.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/prompts.ts
---
Operator: steer and follow-up on ACP are “utterly broken”. Cause — words on `acp` have their own road beside the native one:

- `ProtocolAttendance` writes every word as a `turn`;
- `prompts.ts` hands everything waiting to the agent mid-turn at once and marks it `delivered`, so `pendingInput` is empty and there is no badge;
- `contribution.ts` serves `queue` in `send`;
- `ThreadTurns.unqueue` and `steer` go to the native harness for every thread.

## Do

- **Words.** Enter during a running turn that reads words writes a steer (the reader's `signal`). Tab — and Enter on a turn that never reads words (compaction, Devin) — writes a follow-up (`turn`). Constructors shared with the native thread (`inboxSteerValues`, `inboxTurnValues`). The answer is `steered` or `queued`, like native.
- **Steer handoff.** Mid-turn the driver hands the agent only readable records (`signal`, `envelope`), each with its own `_tagma/steer` carrying the record id. The record stays `queued` under claim until the agent reads it; the echo writes the native `signal` event and confirms the record. A return drops the claim. An unconfirmed record becomes `delivered`, unconfirmed.
- **Cancel.** A waiting record is taken back from the inbox. A handed steer is recalled with `_tagma/withdraw` at the runner (`cancelAsyncMessage`); the answer says recalled or already read.
- **Turn end.** A follow-up opens its own turn after the current one. After Esc, unread steers go in their own turn ahead of the follow-up.
- **Doors.** `steer`, `queue` and `unqueue` on an `acp` thread go to the ACP driver via the same `Harness` port as `send`.

## Proof

A system test through the operator's doors (`ThreadTurns`, the `ThreadEvidence` snapshot) on a scripted ACP agent instead of the Claude Code runner:

- Enter → `steered`, the steer in `pendingInput.steers` until the echo, then a `signal` record;
- Tab → `queued`, the agent gets no words until the turn ends, then a new prompt opens;
- cancel of a follow-up and a handed steer;
- Esc puts the steer ahead of the follow-up.

Additionally: the runner's recall contract test, typecheck, existing protocol system tests.
