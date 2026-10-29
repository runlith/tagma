---
id: 01a118eb-3e7e-7085-8f2e-2cd1fb39e560
title: Native and hosted questions and approvals go through one core, one store, and one deadline machine
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a113ff-0d62-74ec-ae7c-e91101dc1899
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadQuestion.ts
---
Goal: a question and an approval are one subject with one core, one store, and one deadline machine, on the native and hosted roads. Rewind, restore, modes, and `RunStatus` see open questions of both roads the same way.

## Now

- Native questions live in the thread row's `pendingInteraction` slot under the transition kernel.
- Hosted questions live as transcript entries plus an in-memory `Deferred` map (`HostingQuestions.ts:104-138`, `ThreadHosting.ts:236-254`).
- Both roads derive one `questionId` (`ToolQuestion.ts:295-302`), with no reconciliation between them.
- A hosted approval with no deadline waits for a durable question until the run settles (`HostingQuestions.ts:217-239`, `ThreadHosting.ts:518-528`). This is deliberate: the question belongs to the run, survives transport loss, and a reconnect picks it up ([[8e0f35a1]]).
- Rewind guards see native questions but not hosted ones (`ThreadRewind.ts:143-147,296-306`).
- `ThreadHosting` repeats on its side:
  - step-rule timing,
  - the active-tool filter,
  - result recording,
  - replay de-duplication,
  - its own question machine,
  - its own wait port,
  - its own bypass cleanup.

  So for these edges the [[8e0f35a1]] note's phrase "with no second copy of a tool, rule, or policy" is wrong.

## What gets built

- `thread/interaction`: `Questions.ask | answer | expire | bypass` — one core. The store is journal entries, and the row slot becomes their projection. One deadline machine, shared with `ApprovalParking` ([[7e9130bd]]).
- `Questions` fills the approval port declared by the door ([[9bc6e931]]).
- Migration: open native questions move from row slots into the journal with no loss, and readers know one shape.
- A question's lifetime is set by the run's or thread's logical end and an explicit deadline. Handover or process crash keeps a parked question. The calling transport's presence never sets it: a lost HTTP caller does not cancel the question.
- `ThreadHosting` hands questions to the core `Questions` and takes step rules, the filter, result recording, and replay from the shared run parts ([[a34152ed]] `RunAssembly.hosted`). No copies remain.
- Mode entries (what happens to waiting questions on a mode change) are the mode's `onEnter` from [[bb429da3]], shared by both roads.
- The [[8e0f35a1]] note is fixed by the same change.

Boundary with [[01dc1899|the ACP road with no second roads]]. That spec owns the external-harness side: driver, runner, ACP protocol, translation of Claude's approval into a native `ThreadHosting` question ([[7c54d3ed]]). This spec owns the core side in `packages/agent`: a `ThreadHosting` question is a question of the single core `Questions`, and a hosted run is assembled by the shared `RunAssembly`. The shared core owns the open-question fact. Before publishing awaiting, the ACP adapter seals the open message and restores the live stream when the wait lifts (`external-harnesses/protocol/steps.ts:437-449`, [[3b671eda]]); that sequence stays with one owner. The shared wait-notification port is either kept or replaced in one change with all consumers: duplicated state goes, the transport duty stays. Both specs point at this one contract.

Hosted-road tool calls are recorded with the same typed entries as native: name, display, `ThreadToolState`, and outcome from one settlement projector ([[c3436715]]). The server-side ACP adapter translates raw ACP shapes into them (module [[287a4906]]) before ingress. Neither core nor client parses ACP shapes.

Operator decision: the hosted road (ACP) works like native. Questions, approvals, and lifecycle edges are unified now, with no duplicated logic. An external-harness thread behaves as close to native as its transport allows. Only what the transport cannot do differs; each such difference is named in the road's code as a transport property, not as a second copy of a mechanism.

## Acceptance criteria

- Test: a hosted question survives transport loss and is answered after reconnect. A question with a deadline expires with the typed outcome on both roads alike. A run end closes its questions.
- Test: rewind refuses on an open hosted question exactly as on a native one.
- `RunStatus.openQuestions` ([[9f3bb3f9]]) holds both roads' questions from one source.
- Migration test: a store with an open native question answers after migration under the same id.
- `rg` over `ThreadHosting`, `HostingQuestions`, and `hostedRuns`: no own question machine, no second wait-state owner, no own bypass cleanup, no own result recording or replay de-duplication. All of it goes through `Questions` and `RunAssembly.hosted`.
- Hosted-wait test: seal of the open message → awaiting → answer → resume, and reconnect, pass with no loss and no double entries.
- ACP-call translation into typed entries keeps the de-duplication of Tagma-executed calls (`protocol/projection.ts:141-145`, [[ae10d61d]]).
- Test: switching mode to bypass resolves pending approvals of both roads alike.
- `ThreadHosting` and the hosted paths gain unit tests on the question contract (none exist now). `ThreadHosting.ts` stays under 650 lines.
