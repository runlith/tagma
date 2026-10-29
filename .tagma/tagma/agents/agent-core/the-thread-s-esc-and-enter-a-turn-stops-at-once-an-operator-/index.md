---
id: 01a15eeb-6b48-7ca8-9c93-24d37efa9a83
title: "The thread's Esc and Enter: a turn stops at once, an operator word arrives exactly once — identically on native, ACP, and terminal"
ord: 91
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: packages/agent/src/thread/transport/contract.ts
---
The operator presses Esc — the agent turn ends at once: with any focus in the thread, in any turn state, on any transport. Presses Enter — the word is accepted, visible, and reaches the agent exactly once, in press order. No link between the key and the agent may silently lose, delay, or recast these two acts. These are the two gestures by which any Tagma user drives the agent, and they must work like a switch.

## What stands now

Incident 2026-10-21, Claude Code on ACP thread `01a15e6d-3b62-7149-83a8-187dd16e7926`, run `01a15eca-079e-7a0c-a56f-2c81802ae4ef`:
1. The operator sent a word mid-turn and pressed Esc 2.6 s later.
2. The stop request reached the core: 14:11:01.764, the `thread_run.stop_request` column.
3. Claude Code cut the model request after ~70 ms.
4. The runner could not recall the already handed word and, by its "surviving word" logic, let Claude Code execute it as a new turn: 35 s of thinking and an answer.
5. All following Escs and interrupt repeats the runner discarded: the turn was already marked cancelled (`runner/claude-code/turn.ts:163`).
6. The second result overwrote the "cancelled" outcome (`turn.ts:269-282`). The core recorded `completed`, ignoring the standing stop request (`RunLifecycle.completed`).

The operator saw Esc not working.

An audit of the whole chain found one cause beneath every particular failure: interruption has no single owner with a contract. Esc travels 6–8 links, and each can silently lose or delay it:
- **The client** catches Esc only in the input field. On a reconnecting feed it turns Esc into rollback preparation, swallows the "no turn going" answer, and has no "stopping" state.
- **The core** first writes the request to the database and only then interrupts. A transport's interrupt travels without a receipt. The 30-second stop ceiling includes command cleanup and turns an executed stop into a refusal. An ordinary turn end ignores the standing request.
- **The ACP driver** queues cancellation under one lock with all thread work, and in the frame queue behind image frames.
- **The Claude runner** holds the turn alive for an unrecalled word and discards repeated cancellations.
- **The terminal transport** kills the CLI process with a signal on a stop instead of Esc in the PTY, and silently answers success for an unknown turn.

"Esc always stops" reliability on 2026-10-21 is 4 of 10. By link: client 4, core 5, native loop 7, ACP driver 4, Claude runner 3, terminal 3.

## Terms

- **Stop** (`stop`) is an act of the operator or an agent over the thread's current turn. One for all doors: Esc, the Stop button, the thread-list menu, `stop_run`, `stop_agent`, archive, deletion, rollback.
- **Interrupt** (`interrupt`) is a transport's act over its own agent: cut the native loop's fiber, send `session/cancel` to the ACP agent, print Esc in the PTY. The agent's process and session live on.
- **Kill** (`kill`) ends the agent process or CLI. This is a separate explicit act (a process in the process list, a terminal); a turn stop never reduces to it.
- **The interruption receipt** is the transport's fact that the interruption executed: the fiber is cut, the cancel frame is recorded in the agent's stdin, the interrupt bytes are recorded in the PTY. The vendor agent's answer about the interrupted turn is a separate, later fact.
- **A mid-turn word** (steer, "Next step", Enter on a going turn) is read by the agent at the next turn boundary. **A post-turn word** (follow-up, "After this turn", Tab) opens the next turn.
- **A turn** is a core run (`thread_run`). **A vendor turn** is an external CLI's turn inside it.

In code each notion has one name. The core's `halt`, `abort`, and `cancel` reduce to `stop` and `interrupt`; `session/cancel` remains the ACP protocol's name.

## Invariants

1. **Esc is visible at once.** In the same interface frame as the press, the thread shows "Stopping…". Repeated presses add nothing.
2. **A stop is a Tagma fact, not a vendor request.** A turn ends `aborted` on its own transport's interruption receipt, without awaiting the vendor agent's answer. The turn tail seals at the interruption point. Everything the agent emits about that turn after it does not enter the turn journal. The next turn awaits the agent's readiness on the fact — its answer to the cancellation; this wait is visible as a wait cause, not as "agent working".
3. **After Esc the agent does not continue.** A vendor turn started after the interruption (by an unrecalled word, by an echo, by merged words) is interrupted by the transport on the fact of its start. A repeated Esc always reaches the agent.
4. **An end after a stop is always `aborted`.** If the turn ended itself while the stop was traveling, the end is recorded `aborted` with `stoppedBy` and a mark that the agent managed to finish.
5. **The stop goal is the thread's current turn**, not a feed id. A caller naming an expected turn receives an explicit answer with the current turn on mismatch, not a silent `not-running`.
6. **No silent outcomes.** A stop has exactly three answers, each visible to the operator: `stopped`, `requested` (another server process owns the turn and will execute the request), and `nothing-running`. A refusal is possible only on failure and always with a cause.
7. **A word is always accepted.** Enter persists the word before any decision about it. No race with a turn end or start, no vendor session reopening, no turn mismatch loses it. The word is visible at once and reaches the agent exactly once, in press order.
8. **"Stop and send now"** behaves identically on all transports. Esc ends the turn, then all waiting words (steer and follow-up) open one next turn in press order. The hint at waiting words draws from the same decision that executes Esc.
9. **Transports differ only in declared capabilities** (for example, `steer`: at the turn boundary or after the turn), never in Esc and Enter behavior.
10. **Verdict on the fact.** No stop or delivery turn decides by timer expiry. Where there is nothing to await, the answer arrives at once.

## Architecture

Each link has one owner, and the path is one:
- **Client** (`packages/chat-ui`, `apps/tagma/app/src/lib/features/threads`). The thread surface owns its keys. The thread session is the stop act's single owner and holds the "stopping" state from the press until the frame with the turn end.
- **Door** (`stop_run`, `apps/tagma/server/src/threads`). For the intent it opens no graph and awaits no journal. It answers when the interruption executes; command and call cleanup run after and record their outcome separately.
- **Core** (`packages/agent/src/thread/run`). One owner of the server process's live turns; that role is now spread across `RunExecution` with five collections, `RunBeater`, transports' `holds`, `RunCount`, and the database line. The owner registers every turn of every transport, holds the stop intent in memory, calls `interrupt` at once, writes the durable request in parallel (for restart and another owner), and writes the turn end.
- **Transport contract** (`packages/agent/src/thread/transport/contract.ts`). `interrupt(run)` answers with the `interrupted` or `no-turn` receipt, not `void`. After `interrupted` the transport continues the turn nowhere — neither in the journal nor at the agent's.
- **Transports** — native, ACP (driver and Claude runner), and terminal — each executes the contract at its own place. The core does not branch on their kind.

Leaving:
- the three `RunExecution.halt` branches by transport kind;
- the native run's second `RunStop`;
- the ACP line's `cancelling` and `turns.stoppedBy` flags as stop-intent owners;
- the client's `stopWhenRunStarts`;
- the 30-second `bounded` around the stop;
- the separate stop implementation in the menu and thread-list preview;
- fan-out `interrupt` across all transports.

## Speed

Goals on the operator's machine. One measurement is one sample; the conformance set measures time but rules on the fact:
- Esc → "Stopping…" on screen: the same frame, no network.
- Esc → turn `aborted` in the feed: for native no more than 100 ms; for ACP and terminal no more than 150 ms plus the cancel-frame record time, without awaiting the vendor.
- Enter → word in "Next step": the same frame; server admission — no more than 100 ms.

Cost is removed at the producer. Interruption does not stand behind a SQLite write, a driver lock, an image frame, an attachment load, or a settings-record write.

## Observability

Every stop and every word leaves a thread activity record:
- who and through which door;
- which turn was expected and which was going;
- the transport receipt and its time;
- the turn-end moment and outcome.

Today nobody records the press and the stop outcome, and the incident was reconstructed from indirect traces: the `stop_request` column and the cut reasoning.

## Proof

The work is accepted when:
- the shared "Esc and Enter" conformance set passes for native, ACP (scripted ACP agent and Claude runner on a fake `Channel`), and terminal;
- the 2026-10-21 incident is reproduced by the runner test (word handed over, Esc before its echo, recall unconfirmed), and the turn ends `aborted` with no second vendor turn;
- the Claude Code interruption measurements are recorded as #research with the `claude` version.

What the operator checks by hand is not an acceptance condition.

## Order

1. First the core and the transport contract: the rest stand on the receipt and on "end after stop is `aborted`".
2. Second the Claude runner: it holds the incident's cause.
3. Then in parallel: the ACP driver, the native loop, the terminal, the client, and operator words. The conformance set grows with each part.

Graph explanations changed by the work are corrected by the same work. Among them [[e47bd3fc]]: its claim "Stop ends the core earlier than Cancel reaches the agent" is wrong for an ACP turn — the turn lived 36 s under a standing request. Also [[e35a759f]] and [[fcbe2a1d]].

## Out of scope

- Killing the process stays an act of the host's terminals and processes; the spec only requires that a turn stop never reduces to it.
- Esc pressed right in a terminal thread's TUI is the CLI's own business.
- Cutting a model stream for a mid-turn word without awaiting the turn boundary is a separate product decision.
