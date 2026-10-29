---
id: 01a12699-1673-714b-a6a5-79e9959a4005
title: Update waits for the safe point of running work and never waits for what survives restart
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/service/succession.ts
---
A human presses "update" while agents work, and loses nothing: the update prepares at once, and the restart lands on a safe point. Only what would have an unknown outcome after restart is waited for. What survives restart is never waited for.

## What happens now on restart

| Work | What the code does | What it costs |
|---|---|---|
| Native-agent model request in flight | Breaks; after start the run is accepted anew and continues from kept state (`packages/agent/src/thread/transport/native/adoptions.ts:42-94`) | The request is asked again and paid twice; the unrecorded tail of the answer is lost. A handed run unaccepted in 20 minutes breaks (`packages/agent/src/thread/run/ThreadRunReaper.ts:105-130`, `threads/contract/wire/rhythm.ts:21-25`); a run with an exhausted budget is never accepted (`adoptions.ts:49-53`) |
| Native-agent tool running | The open call is counted up after start (`packages/agent/src/thread/run/ThreadEffectSettlement.ts:19-79`) | Outcome — done, broken or **unknown**: with no receipt the effect cannot be said applied |
| Claude or Devin stream over ACP | The process lives in the execution host; the new driver takes it over and rereads output from the kept cursor (`external-harnesses/protocol/process.ts:61-76,304-356`) | The model request continues inside the CLI. An undefined prompt never repeats |
| Foreign-CLI terminal stream | The execution stays with the host, the driver reconnects (`external-harnesses/sessions/drive.ts:300-353`) | Its Tagma tool calls over the MCP bridge get `server-unanswered`, and the bridge never tells "not accepted" from "outcome unknown" (`cli/verbs/mcpServe.ts:39-64`) |
| Background commands and terminals | Survive in the execution host (`packages/execution-host/src/HostConnections.ts:570-588`) | Their deadlines keep running |
| Server-accepted unfinished operation | Its fiber dies; a background call of the next epoch is recorded with unknown outcome (`threads/collaboration/callEndings.ts:133-151`) | The work never continues; a retry with another key makes a second effect — e.g. a second block (`graph/blocks/birth.ts:148-169`) |
| Open approval question | The question is kept, the answer after start continues the turn (`packages/agent/src/thread/run/ParkedQuestions.ts:90-119,208-275`) | — |
| Install build from checkout | The unfinished-build record is marked failed (`installation/builds/checkout.ts:249-274`) | The build is broken off |
| Worktree create and merge, commit steps | The process stops; recovery cancels its unfinished merge or counts a known publish up (`landing/merge/recovery.ts:22-87`) | The operation never continues; an unknown publish never repeats |

## Rule

Once the update is accepted the server keeps answering and brings running work to a safe point:

- **Waited**: an effect whose outcome after restart would be unknown: an accepted unfinished operation with an effect, from whatever door it came — HTTP, MCP, CLI, agent tool; a native-harness tool executing in the server process; commit, merge, worktree create, commit steps, install build; an answer to a question already executing an effect; a running dictation to its end.
- **Never started**: new long effects: a native run stops at the step boundary. Human words still queue, drafts work, short operations run as usual.
- **Never waited**: what survives restart: ACP streams and terminal streams, background commands and terminals in a compatible execution host, open questions.
- **Broken off**: the in-flight model request, once everything else is at a safe point: it is asked again after restart. A second paid request is the price of updating mid-work, and a human sees it before consent.

**The last step is closing the door.** The door stops accepting operations and waits for accepted ones' outcomes; only then owners close. An operation that may run past the window budget must be visible to the safe-point port upfront, so it is waited for while the server is alive, not in the window.

**A run stopped by an update is a deliberate pause, not an abandoned run.** The deadline recovery judges abandoned runs by never applies to it: it continues after launch however long the launch took, including after a declared heavy update. Budget policy stays: a run with an exhausted budget never continues, and that is named to a human before restart.

While waiting, a human sees what is waited for: which threads and which actions. He may restart now; then what becomes unknown is named to him. Waiting runs while the server is alive and never enters the window.

An execution host incompatible with the new build, with live executions, is named before the predecessor leaves, and force-finishing its executions is a separate explicit human choice.

**Window calls.** A call arriving after the door closed gets "server restarting, call not accepted" — repeatable. A call whose answer is lost after acceptance stays of unknown outcome, and nobody is advised to repeat it. The MCP bridge and CLI hand that difference to the caller.

## How built

- Install is the bottom module and knows nothing of runs, landing or dictation. It declares the safe-point port in its `contract/service`: a work owner reports what must not be interrupted now, and stops new long effects short on request.
- The port is filled by: operation calls — once for all doors (accepted operations with an effect), native harness (tools in the server process and the step boundary), landing, worktrees, install builds and speech. Composition wires them.
- The restart owner asks the port, shows the answer to a human and moves to ownership handover when the port is empty or a human picked restart now.
- Recovery after start stays with the current owners. Two things change: no effects of unknown outcome are left by restart time, and the update pause differs from an abandoned run.

## What the implementer proves

- An update accepted while an effect tool, merge or build runs never restarts the server before their end, and their outcome is recorded as known.
- An operation accepted over MCP before the door closed gets its answer; a call after closing gets "not accepted" refusal and runs once after restart.
- A native run stopped at the step boundary continues after restart with no human — even when launch ran past the deadline that judges an abandoned run.
- An execution in the execution host (ACP stream, background command) has the same identity after restart, and the update never waited for it.
- An open approval question is answered after restart and continues the turn.
