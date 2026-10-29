---
id: 01a121e1-8304-7f20-b17b-923e5add92f2
title: "Many recipients for send_message, send_task and interrupt_agent: one call, one envelope per recipient, admission by one keyed act, one approval question"
ord: 40
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cd787916291
  - kind: relates
    to: 01a11c26-7d19-7b9a-8bcc-295722b5531d
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/collaboration.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/collaboration.ts
  - kind: file
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
  - kind: file
    ref: packages/agent/src/collaboration/sendTools.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadEnvelopes.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadPlanes.ts
  - kind: file
    ref: packages/agent/src/thread/storage/InMemoryInboxStorage.ts
---
Goal: an agent sends one words to several agents with one call. `send_message`, `send_task`, and `interrupt_agent` take a list of addressees in `to`. The text is written once, one feed line at the operator, one question in review, and each recipient receives exactly the envelope it would have received from a separate send.

## Why

The orchestrator broadcast one correction to ten agents with ten `send_message` calls. There is no other way now: at the three send verbs `to` is one address (`AgentAddress` in `collaborationVerbs.ts`), and each call yields its own feed line, its own verdict, and its own question.

Example: a correction of about 400 tokens, 10 recipients. The numbers are an estimate from reading code, not a measurement.

| | 10 calls | 1 call with a list |
|---|---|---|
| tool calls | 10 | 1 |
| model output tokens | ≈ 4,250 (text ×10 plus arguments) | ≈ 470–680 (text ×1 plus 10 addresses) |
| generation at ~60 tok/s | ≈ 70 s | ≈ 10 s |
| sender history growth, re-read by every next step | ≈ 5,400 (calls and 10 receipts) | ≈ 1,600–1,800 |
| operator feed lines | 10: sends are `mutates: true`, and `foldable` in `packages/chat-ui/src/activity.ts` does not fold mutating calls | 1 |
| approval questions in review | 10 | 1 |
| each recipient's context | unchanged | unchanged |

When the model sends the calls sequentially rather than in parallel in one step, 9 more steps join in, each re-reading the whole history prefix.

There is no simpler path with the same win:
- an address selector like "all my children" covers no arbitrary subset and introduces an address grammar;
- forwarding by envelope id removes the repeated text but leaves N calls, N lines, and N questions.

## Decisions

### 1. Input

- `to` is always a non-empty address list (a name in the team or a thread id); one addressee is a list of one. Core, response, and key know one form.
  - Why not a "address or list" union: models confuse them. A model on Muse passed a list as a string with JSON inside (`"[\"01a…\"]"`), and the final answer never arrived ([[3bc177d6]]). One form rules that error out, and extra brackets at a single addressee cost nothing.
  - Calls recorded before the transition with a string in `to` are read by `addressesOf` (`toolCalls.ts`): mapping, subjects, settlement, and stream input.
- The upper bound (`RECIPIENT_CEILING`) is the answer's ceiling: as many receipts as fit into a tool-output envelope. `collaborationVerbs.ts` derives it from the widest receipt the contract admits, in the form the model sees it (JSON with indents), by `TOOL_OUTPUT_MAX_BYTES` / `TOOL_OUTPUT_MAX_LINES` bytes and lines. A sample of it:
  - a name — 64 characters at 3 UTF-8 bytes (CJK);
  - a call key — 40 characters;
  - an `unconfirmed` or `failure` cause — 160 characters at 3 bytes.

  `sentOutput` trims every cause to 160 characters, so the sample truly is the widest. By this sample the bound with the recipient's home project in the receipt is 41. The schema carries it as `maxItems`, and the field description as a number. A name of control characters, which JSON escapes into six bytes, is not covered by this bound: such an answer goes wholly into tool-output spool and is read by reference.
- Duplicates collapse by resolved thread. A name and a thread id of one agent yield one envelope and one receipt at the first occurrence's place. No refusal for repeats: a repeat breaks nothing.

### 2. One envelope per recipient

An envelope is the unit of delivery, state (`queued`, `delivered`, `acknowledged`), run, obligation, and closing, and a `thread_inbox` line belongs to one thread. A shared envelope for all would need an "envelope → recipient" table with each one's state — that is, the same thing separate envelopes give.

- Envelope id: `envelope:<intent>:<sender>:<call key>:<recipient position>`, where the position is the place in the list after collapsing. The form is one for any send, including to a single recipient.
  - The position in the id is mandatory because `thread_inbox.id` is globally unique.
  - Position, not the recipient's thread id: the id stands in the markup at every recipient and in every receipt, and the position costs one token.
- The recipient sees an ordinary `<message from=… thread=… envelope=…>` envelope and does not know the other addressees. Neither the envelope body in the inbox, nor `AgentSignal`, nor the markup changes. When recipients matter to each other, the sender writes it in the text. Showing the list is [[aa4c97b5]].
- Every `send_task` recipient owes its own final answer. Each has its own open request, as now, and its `final` closes only that request.

### 3. Admission and partial refusal

- **Address resolution — all or nothing, before the write.** When even one address does not resolve, the call answers `not-found` with all unresolved addresses and the team's `addressable`. Nothing is written, the key is not taken. The team's address book for `addressable` is read once per call, not once per unknown address.
- **Admission — one keyed act.** The call key, N envelopes, and N wake intents are written in one `ThreadInbox.control` transaction on the sender. Hence `InboxWrites` gains `intendWake` — the same outbox with which `RunReports` already wakes senders of unread reports. A broadcast is admitted whole or not admitted. The wake intent stands only at the envelope this act first wrote: an already-standing item's effect is not repeated. The key with `call` evidence is honored by both inbox adapters — SQLite through `thread_call`, memory through the write registry shared with transitions — and a repeat answers with the recorded act, not a new one.
- **Delivery — per recipient; one failure does not cancel the rest.** After commit, every admitted envelope is delivered by the same `runs.deliver` as now, each with its own receipt: `delivered`, `queued`, `woken`, or `stored`. When delivery to one recipient refused, its receipt is `pending` with the cause in `failure`; the envelope stands admitted and its wake intent stands, so `SenderWakes` will bring it through. The "woken" mark goes only to delivered envelopes. A send has no "unreachable" addressee: a stopped or idling recipient admits the envelope by its own rules, and that is its receipt's status, not a refusal.
- **A break after commit** is completed by the already-working `SenderWakes`: every admitted envelope reaches its recipient, even when the sender's run breaks off or the server falls. A delivery `SenderWakes` began in parallel with the call does not act twice: an interrupt already read by the run stops neither that run nor its successor. `RunScheduler` decides that by the run queue's answer (`already-read`), not by the snapshot of the item the delivery came with.
- **Repeat and settlement answer by the recorded act.** Envelopes admitted under a key are read by id (`…:<key>:<position>`, positions up to the `to` length), and each is delivered to the thread in whose inbox it stands. The address book is not read again, so neither a renamed nor a departed name turns a repeat into `not-found` or pairs an envelope with someone else's recipient.
  - A native-call or operation repeat with the same key checks the recorded act's digest: a different meaning — `key-reused`; the same — the same receipts with `acted: false`.
  - Settlement of an interrupted native call: when no envelope stands admitted under the key — `aborted`, nothing is sent; otherwise it completes the admitted ones' delivery, as `SenderWakes` would complete it, and answers `completed`. Settlement admits no new envelopes.
- **Key.** The keyed act's digest: the `to` addresses in the order and spelling the call gave, intent, text, `inReplyTo`, `final` at a final answer, and `keep` at a task with `compact`. The same key with a different list, order, or address spelling refuses `key-reused`, like any other meaning. The digest runs over the call's addresses, not the resolved threads, because a repeat is checked before address resolution.

### 4. `final`, `compact`, `inReplyTo`

- **`final` — exactly one addressee.** A final answer closes one requester's requests and is written against its newest request, while two requesters asked different things. One addressee counts after resolution and collapsing, as in §1: a name and a thread id of one agent are one addressee. When more than one addressee remains after collapsing, the call refuses `final-to-many` before the write; unblock — send the final answer to each with its own call. A single address that did not resolve follows the departed-requester road as before: its requests close, the answer is `no-open-request`.
- **`compact` at `send_task` — exactly one addressee**, also after collapsing. The delegation voice decides compaction per child, by its warmth and fullness, and `no-summarizer` is decided per idling child and would make the answer partial. A list of several threads refuses `compact-to-many`. The `not-a-descendant` condition raises those same doors' `prepare` over the same resolved recipient (`messaging.aheadCrossing`), so `[x, x]` asks the same as `x`.
- **`compact` — two keyed acts, not one.** The call key (`send:<sender>:<key>`) is written by `ThreadInbox`, and the child's compaction task by the child's scheduler with its own start key. There is no shared transaction between them: inbox and the child's compaction queue are different owners. A break between the acts leaves the key taken with no task. Recovery:
  - a repeat with the same key completes the call: the first act answers with the repeat, the second executes;
  - settlement reads the task envelope by its id: standing — `completed` with a `queued` receipt and no new delivery (its order is held by the child's compaction); not standing — `aborted`.
- **`inReplyTo` is allowed with any list.** It is a fact about the message — what it answers — and is written into every recipient's envelope, like mail "reply all".
- **Recipients' answers.** Each answers its own envelope: its `inReplyTo` is its envelope's id, and one broadcast's envelopes share the `…:<key>:` prefix. The sender tells answers apart by `from`, as now. An ordinary message's `inReplyTo` is written into the body today and shown to neither the model nor the app; this spec does not change that ([[43b04b32]]).

### 5. Approval

- One call — one verdict and at most one question: `ToolAdmission.inspect` judges the call once over the raised conditions, not over subjects. The question over the whole broadcast needs no new mechanism.
- Subjects — `agent://<owner>/<address>` per recipient.
- Conditions rise per resolved recipient and merge. At `interrupt_agent` that is `own-lineage`: a fact per own turn or ancestor in the list, each naming its addressee, own turn included. `messaging.lineage` takes the whole list: addresses resolve once, the sender's ancestor chain reads once, and both doors call it once. One question lists every cause.
- The question's appearance: a summary like "Send this to worker-1, worker-2, worker-3 +7?" and `To` facts with all addressees (when more than one) and `Message`. The question words are built by `messageQuestion`, `taskQuestion`, and `interruptQuestion` in `collaborationVerbs.ts`, and both doors — tool and operation — read them. The confirmation window renders facts as they stand, no new UI.
- The CLI flow calls operations through MCP: the CLI asks its own permission once per tool call, and Tagma sets no second trial ([[6009977c]]).
- This agrees with [[22b5531d]]: the verbs' approval declaration does not change, only what `prepare` raises conditions over changes — by list.

### 6. Feed and transcript

- One line in the sender's feed: verb, recipients (first by name, the rest by count), and the text's first line. The text unfolds once. Facts — delivery statuses, grouped (`delivered 7 · woken 3`), and `team: other` when the addressees include another team's agents.
- Every recipient opens from the line. Display gets a link variant with a list, `{ kind: 'agents', recipients: [{ address, id?, projectId? }] }`: before delivery `address` is the call's address, after — the reached recipient's name or its thread id. The app's `activityIdentity` yields one thread per recipient, and the title line is built by `recipientsTitle` (`@runlith/agent/collaboration/label`) — the same function that yields display's title. The `agent` variant stays at verbs over one agent (`stop_agent`, `continue_agent`, `compact_agent`, `set_agent_model`, `answer_approval`), so saved displays of earlier sends read without migration.
- The recipient's transcript does not change: it holds the same envelope as from a single send.

### 7. Response

Every send answers with one form: `sent` with a `deliveries` list — the core's receipt per recipient in list order (`envelopeId`, `status`, `runId`, `acted`, `recipient`; at a final answer also `closed`, at a task with `compact` — `compaction`). A `pending` receipt carries `failure` — why delivery cannot go through now; the envelope stands admitted and will be delivered (§3).

- Refusals: `refused` with codes `no-open-request`, `final-in-reply`, `no-summarizer`, `final-to-many`, `compact-to-many`, and `not-found` with all unresolved addresses in `addresses`. The `address` field is gone from refusals: the caller knows whom it wrote to, and `not-found` names every unresolved address.
- The current per-call `delivered`, `queued`, `woken`, `stored` answer arcs go away: status is a recipient's fact, not the call's.
- Every recipient's receipt is the same `RunReceipt` [[9f3bb3f9]] builds.

### 8. `send_task` and `interrupt_agent` — the same decision

All three verbs go through one `ThreadMessagingAccess.send`, so fan-out is built once, in it, and `to` is the same at the three verbs: the model would confuse different address forms at neighboring verbs. Only §4 differs: `final` and `compact` take one addressee. `interrupt_agent` with a list cuts every recipient's turn. That is needed when the correction is urgent: an ordinary message is read on the next step, and it does not interrupt a long call.

## Architecture

- `@runlith/agent` ([[d1caad35]]):
  - `collaboration/collaborationVerbs.ts` — the `to` schema (`AgentRecipients`: address or list, ceiling), one phrase about the list in each of the three verbs' descriptions, the `final-to-many` and `compact-to-many` refusal words, the question words of approval for both doors, the response form (`sentOutput`).
  - `collaboration/agentLabel.ts` — `recipientsTitle`: the first three names and the rest's count; display, questions, and the app read it.
  - `collaboration/ThreadEnvelopes.ts` and `envelopeKeys.ts` — `send` takes a list. One owner resolves recipients — `recipients` (`ThreadMessagingAccess`): each address once, with one sender read, collapsing by thread; fan-out, `final`, `compact`, `lineage`, `aheadCrossing`, and `settle` use it. Then one keyed admission act, per-recipient delivery, and repeat by recorded act. When [[87916291]] moves delivery into `collaboration/Delivery`, fan-out moves with `send`.
  - `collaboration/ThreadPlaneAccess.ts` and `ThreadPlanes.ts` — `messaging.send`, `settle`, `lineage`, and `aheadCrossing` over the list; the `compact` path takes one addressee. `reach.ts` — `ownLineage` over the thread list.
  - `collaboration/sendTools.ts` — the three send verbs, moved out of `CollaborationTools.ts`, which would otherwise cross the [[6b3210c7]] ceiling. In it, per-recipient subjects, merged conditions, one question, display with a list, and settlement by key. `toolCalls.ts` holds `acting` and `handed`, shared by both tool files.
  - `thread/storage/inbox.ts` — `InboxWrites.intendWake`; to it `InMemoryInboxStorage` with a keyed act like SQLite's, and conformance inbox.
  - `thread/run/scheduler/RunScheduler.ts` and `inputs.ts` — delivering an item the run already read answers `queued` with `acted: false` and stops nothing.
  - `tool/display.ts` — the `agents` link variant.
- `threads` ([[1a45453a]]):
  - `contract/wire/operations/collaboration.ts` — response arcs, `subjects`, `raises`, and `confirmation` over the list;
  - `operations/collaboration.ts` — `prepare` at `interrupt_agent` and at `send_task` with `compact` over the list;
  - `store/inbox.ts` — `intendWake` in the keyed-act writes on SQLite.
- App: `apps/tagma/app/src/lib/features/threads/activityIdentity.ts` — the `agents` link; `packages/chat-ui/src/ActivityStep.svelte` — recipient-thread links when the app gave no identity.

**Stored data does not migrate.** The envelope body does not change, old envelope ids stay as they are, the display variant is added. A keyed act started before rollout and repeated after it will not match by digest and will answer `key-reused`: the call-repeat window is shorter than the rollout.

**A call's cost grows with the recipient count and only with it** ([[2393aff1]]): N address point-reads, one transaction for N writes, N deliveries; sender and team are read once per call.

**Work**: implementation [[57f1fef4]], review fixes [[33674dd9]].

## What the performer proves

Contract tests through public operations ([[4f387de2]]):
1. `send` to three recipients yields three envelopes with different ids and one text, one keyed act, and receipts in list order.
2. One unknown address of three: `not-found` names it, the inbox holds nothing, and after fixing the address the same key admits the broadcast.
3. A name and a thread id of one agent in the list yield one envelope and one receipt.
4. Repeating the same call answers with the same receipts with `acted: false` and no new envelopes; the same key with a different list — `key-reused`.
5. `final` or `compact` with two addressees refuse with their code before the write.
6. `send_task` to two children opens two requests; one child's `final` closes only its request.
7. Conformance inbox on both adapters: the keyed act writes envelopes and wake intents atomically; a refused act leaves neither; an admitted but undelivered envelope is brought to the recipient by `SenderWakes`.
8. The native tool in review: one call to three recipients sets one question with three addressees; `interrupt_agent` with its own ancestor in the list — one question with an `own-lineage` cause.
9. The operations door integration: the CLI flow sends `send_message` with a list, every recipient receives an envelope with `from` — the CLI thread, the response carries `deliveries`.
10. Conformance on both adapters: a keyed act with the same key and digest answers with the recorded result and writes nothing; with a different digest — a conflict, nothing written.
11. Repeat and settlement answer by the recorded act, even when the name it addressed moved to another or to nobody.
12. A delivery refusal to one recipient: its receipt is `pending` with a cause, the wake intent stays only at it, the rest are delivered.
13. Conformance on both adapters: an interrupt delivered again with the snapshot it was admitted with, after the run read it, stops nothing.
14. `final` with a name and a thread id of one agent — one addressee; its settlement — `completed`.

## What the operator checks

Not a task-closing condition. The orchestrator broadcasts one correction to several children: one line in the feed with recipients, each child sees an ordinary message, one question is set in review.

## Outside this spec

- Showing the recipient the other addressees — [[aa4c97b5]].
- `inReplyTo` visibility — [[43b04b32]].
- `spawn_agent` with a list: every child has its own brief, model, and name, so those are N different acts, not one words to many.
- `stop_agent`, `continue_agent`, `compact_agent`, and `set_agent_model` with a list: they carry no text, so the broadcast's main win does not apply to them. Feed lines and mass-stop questions are a separate decision.
