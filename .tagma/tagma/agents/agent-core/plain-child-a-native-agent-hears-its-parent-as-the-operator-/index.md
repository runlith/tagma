---
id: 01a146bd-69c8-71fa-bb83-96996cfb2a0f
title: "Plain child: a native agent hears its parent as the operator — spawn_agent with plain: true, without birth, envelopes, or team voice"
ord: 60
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a141bd-0e7f-7dc8-8ef7-ab6a510a47c0
sources:
  - kind: dir
    ref: packages/agent/src/collaboration
---
## Why

A/B experiments compare the native Tagma agent against plain Claude Code (`threads.harnessProfile` … `plain: true`) on the same tasks set by a leading agent. Plain Claude Code receives the lead's words as ordinary user messages. A native child receives `<agent-birth>The tagma agent started you…</agent-birth>`, `<task from=… thread=… envelope=…>` envelopes, and the Collaboration section about the final-answer duty — so a word the lead passes on from the operator reads as an agent's word to it. Measured: a correction typed by the operator into the thread becomes a `#rule` (the doctrine "A norm the operator states for work to come … is written in that turn as law"), while the same correction passed via `send_task` does not — twice — and adding "the parent relays the operator" to the prompt did not change this. The comparison is unfair.

## What the user gets

**Switching on.** `spawn_agent` with `plain: true` — on the native tool and on the operation for CLI threads. The mode is a property of one thread: chosen at its birth and standing on it until its end. Not a project setting and not a default.

**By the operator's word only.** `plain: true` raises the `plain-child` ("Plain child") approval condition from the trust step: in trust and review the call becomes a question to the operator, because the child will mistake the agent for the operator. In bypass the operator itself chose not to be asked about anything.

**Native agent only, no fork.** On another harness type it refuses `harness-contract`: a CLI has its own plain — the vendor profile. `plain` with `fork` or `forkFrom` refuses `plain-fork`: a fork carries the parent's own conversation together with this spawn and its frozen instructions with the team voice, so the child cannot take the parent for the operator.

**Detaching.** `detach_thread` and `reattach` do not write parent notifications to a plain child; the parent keeps receiving its own. After detachment the child has no parent, and the former parent's words arrive as an ordinary envelope.

**Delegated approval.** If the operator made the spawning agent an approver for `spawn_agent` (`approves`), the `plain-child` question goes to that parent, like `New worktree`: the operator itself handed it the spawn decision.

**What the plain child sees:**
- no `<agent-birth>`: the first message is the parent's task verbatim, as a user message;
- the parent's `send_task` and `interrupt_agent` open its turn with the parent's words the same way a turn typed by the operator opens; `send_message` during a turn arrives as the operator's steer, at rest it opens a turn with the same words;
- the Collaboration section is the root voice, as in the operator's thread: no parent, no team, no `from` envelopes, no final-answer duty; the closing reminder of the duty does not appear;
- its own tools stay: it can spawn helpers, and they are ordinary team members; envelopes from everyone but the parent (its children's reports, peers' words) arrive as they do now.

**What the parent sees — as now.** The last message of every run opened by a task (`spawn_agent`, `send_task`) arrives as its report; a cut or crashed run as a diagnosis. A run opened by `send_message` does not report in this mode either: the parent's tool contract does not change (message waits for no answer, task waits), and the child, knowing none of its duties, answers the same way. Need an answer — `send_task`.

## Design

**Where the mode lives.** `thread_mandate.plain` (boolean, default false; migration ADD COLUMN) — the mandate with which the parent bears the child, beside authority, budget and host. Not `TransportCapabilities`: the transport writes those and rewrites them when reseating or changing provider, and the mode must survive that. `ThreadMetadataRow.plain` → `ThreadRecord.plain`.

**Birth.** `plain` travels `spawnAgentInput` → `ThreadSpawnAsk`/`ThreadSpawnRequest` → `births.spawn` (fork and harness checks) → `BirthInput.plain` → `insertChild` → mandate. In `births.answer`, a plain child does not get `collaborationBirth` placed before the task. `BirthRequest` carries `plain`, so retrying the same key with a different `plain` is a conflict.

**Word voice — on the inbox item, decided in one place.** The envelope is built by `itemOf` (`envelopeActs.ts`), the birth task by `provision` in `births.ts`. When the recipient is plain and the sender is its current parent, `sender` gets `asOperator: true`. A detached child has no parent, and words go by envelope again. Other owners — reports, obligations, receipts, revocation — read `kind` and `sender.threadId` as before.

**Render.** `threadSignalOfInboxItem` for `asOperator` yields operator-word signal (`user-message`, addressee `reader`, no `from`/`thread`/`envelope`). `queuedTurnText` returns `body.text`. Waking a turn from rest (`wakeItem`) writes a user message, like an operator's turn.

**Prompt.** `ThreadPlanes.access` hands a plain thread `parent: null` → `rootCollaborationPrompt`. `collaborationClosingLayer` skips `asOperator` requests.

**Approval.** `PLAIN_CHILD` (`asksFrom: 'trust'`) in `when` of native `spawn_agent` and of the operation; `plainRaised(input.plain)` — in both doors.

## Proof

Performer:
- `bun run typecheck` in `packages/agent` and `apps/tagma/server`;
- an itest on the real core (`requestObligation.itest.ts`): a plain child receives the birth task, the parent's `send_task` and `send_message` as a user message equal to the parent's words; a run that changed a file ends without an extra step; the parent receives a report with the last message of a task-opened run, and none for a message-opened one;
- a live `spawn_agent` with `plain: true` on its own `tagma:try` where a model account exists.

Operator: an A/B run where a correction passed by the lead via `send_task` behaves like a correction typed into the thread.
