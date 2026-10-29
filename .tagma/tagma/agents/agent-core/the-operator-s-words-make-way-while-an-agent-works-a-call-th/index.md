---
id: 01a0f3e0-df87-7dfb-bfa9-8b15356d0443
title: "The operator's words make way while an agent works: a call that only waits ends, a running foreground command moves to the background, the model is told what ended, and a foreground sleep is refused"
ord: 173
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/invocation/nativeDoor.ts
  - kind: file
    ref: packages/agent-tools/src/bash/tool.ts
  - kind: file
    ref: packages/agent/src/agent/AgentCalls.ts
  - kind: file
    ref: packages/agent/src/agent/AgentRunner.ts
  - kind: file
    ref: packages/agent/src/agent/AgentToolDoor.ts
  - kind: file
    ref: packages/agent/src/agent/tool.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunInbox.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunStarter.ts
---
## 1 Outcome

The operator's words reach an agent at once while it works. A call that only waits on work running without it — `read_output` with `wait`, `wait_command`, `wait_terminal`, `wait_call` — ends when the operator's words arrive for its run. A foreground command that is running when the words arrive moves to the background, and nothing is killed. The agent's next step reads the words. Every such ending tells the model what ended and that the watched work keeps running. A foreground bash line that only sleeps is refused before it runs.

## 2 Problem, with its evidence

Thread `01a0e9a1` (project 7), 2026-09-30:
- 18:45:35Z. The agent launched a typecheck and a unit-test gate with `background: true`, then called `read_output` with `wait: 280` on each. The run stood in those two calls.
- 18:46:30Z. The operator's message was accepted into the run and waited behind the calls, because a signal is read at the next step and the step could not end.
- 18:47:05Z and 18:47:09Z. The operator pressed **Stop waiting** on both reads. The model received `{"status":"cancelled","reason":"Stopped by the operator."}`, the same words any stopped call gets (`AgentCalls.control`), and told the operator he had stopped the checks. Both commands ran on and ended exit 0.
- In its next turn the agent told the operator that his message had cut the read, which was also false: only the button produces that reason. Its reflection [[d6eb49bc]] records that false cause.

Claude Code 2.1.285 answers the same situation this way. A foreground command running when a message arrives is moved to the background ("so that a message that arrived while it was running can reach you; it was not interrupted"), and a foreground `sleep` is refused, naming `run_in_background`. The open request anthropics/claude-code#83817 asks that an incoming message end a blocking task wait while the task lives on.

## 3 What holds now

- Words for a running run land in the local signal queue (`ThreadRunInbox`) and are drained only at a step boundary ([[cd67b06f]]). Nothing tells the run's calls that words arrived.
- `AgentCalls.control` stops a call with `Stopped by the operator.` / `Stopped by the agent.` whatever the call is. `AgentToolDoor.stoppedAnswer` answers every stopped call `{status:'cancelled', reason}` and draws a call stopped inside its body as failed ([[e31a7c60]]).
- The hand-off to the background already exists for every running call. It releases the model's wait, keeps the body running and delivers its outcome as a notice ([[6c8f9ea4]], [[1093f1ae]]). Only a press or `control_call` reaches it.
- The bash tool refuses some lines at preparation, such as a bare commit ([[cf7fa5c0]]). It refuses nothing for sleeping.

## 4 Target model

- **A call that watches.** A tool may declare `watches(input)`: the call only waits on work that runs without it, so ending it ends nothing but the wait. The operation entry carries the same `watches` and the native door passes it to the tool. `read_output` watches when `wait > 0`; `wait_command`, `wait_terminal` and `wait_call` always watch.
- **A watch ends honestly.** A watching call that is stopped answers `{status:'wait-ended', reason, untouched}`: `untouched` says the work it watched was not touched and keeps running. Its row is not drawn failed. The operator's **Stop waiting** gives the reason `The operator ended this wait.`
- **Words make way.** When the operator's words (a `user-message` signal to the reader) become readable for a run in this process, the run's queue tells the agent. The agent's call owner then acts on each foreground call of that run that is still standing:
  - a watching call is stopped with a reason saying the operator's words arrived;
  - a call holding a live command is handed to the background, as the operator's hand-off would be, and answers its tool's receipt;
  - every other call is left alone.
- **Words already waiting.** Until the run has drained those words, a watching call that starts ends at once, and a command linked by a call hands its call to the background, so a wait called while the model was still writing cannot hold the words.
- **No blind sleep.** A foreground bash line whose every simple command is `sleep` is refused before anything runs. The refusal names `background: true` for waiting on a command and a background `until <check>; do sleep 2; done` for waiting on a condition. `sleep` inside other work, and any background line, run as before.
- **The tools say it.** `read_output`'s `wait`, `wait_terminal` and `wait_call` say that the wait ends early when the operator's words arrive.

## 5 Owners and boundaries

- The declaration `watches` is the tool vocabulary's ([[b645577c]], `packages/agent/src/agent/tool.ts`); the operation entry's is `platform/contract/wire/operation.ts`; the native door carries it (`invocation/nativeDoor.ts`).
- What becomes of a call is the call owner's (`AgentCalls`), and the stopped answer is the door's (`AgentToolDoor`).
- The queue that holds the run's words is [[9da5905b]]'s (`ThreadRunInbox`); the run starter passes its notice to the agent through the run's signal port; the runner (`AgentRunner`) joins the two. The thread layer decides nothing about calls; the agent layer decides which words make way.
- The sleep refusal is [[4024d28f]]'s detection and the bash door's act ([[2657028c]]).

## 6 Rejected alternatives

- **Every signal makes way.** Child reports, envelopes and command-ending notices arrive often; ending a wait on each would make an agent re-wait in a loop. Only the operator's words make way now. Agent envelopes are a separate question.
- **Hand every running call to the background.** A read or an edit ends in milliseconds; handing it off turns its answer into a notice for no gain. Only a call holding a live command moves.
- **Cap every wait short, as Codex does (30 s per wait).** The model pays a step and tokens for every re-poll, and the words still wait up to the cap.
- **Keep the words queued and only fix the text.** The words would still wait up to ten minutes behind a wait.

## 7 Acceptance criteria

1. A run standing in `read_output` with `wait` on a running command: the operator's message ends the call, the agent's next step reads the message, the command keeps running and its ending still reaches the thread.
2. That ended call answers the model `status: "wait-ended"` with the words-arrived reason and the `untouched` sentence, and its row is not drawn failed.
3. **Stop waiting** on such a call answers `wait-ended` with `The operator ended this wait.` and the command keeps running.
4. A foreground bash command running when the operator writes is moved to the background and answers `Moved … to the background`; it keeps running, its ending reaches the thread, and the message is read at the next step.
5. A `read_output` wait called after the operator's words arrived, and before the run read them, ends at once.
6. `bash` with a line of only `sleep` in the foreground is refused before anything runs; `sleep 2; cd x && …` and a background `sleep` run.
7. The typecheck and the unit and integration layers pass for `packages/agent`, `packages/agent-tools` and `apps/tagma/server`.

## 8 Claims and tasks this touches

Rewritten from the code after the build: [[e31a7c60]] (a watching call's stop answers wait-ended, not failed), [[dc751092]] (what Stop waiting tells the model), [[cd67b06f]] (words now also notify the run). New claims: the watch declaration, words making way, the unread-words window, and the sleep refusal. [[d6eb49bc]]'s false cause is corrected in its body. [[972bbdbc]] and its task are independent.

## 9 Order of building

The `watches` declaration and the operation entries, then the door's answer, then the call owner's way-making, then the queue notice and the runner's wiring, then the sleep refusal, then the tool texts, then tests, then the claims.

## 10 Contract

`Tool`, `ToolDeclaration` and `Operation` gain an optional `watches`. `ThreadSignalQueue` gains `readable`; the run's signal port gains an optional `readable`. A stopped watch's answer changes shape from `cancelled` to `wait-ended`; stored rows keep what they said. No wire version moves.

## 11 Stored data

out: nothing new is stored; the unread-words mark lives in the call owner's memory and dies with the run.

## 12 Who may do what

Only the operator's words make way. The hand-off they cause is the same hand-off the operator's press makes, under the operator's authority, so it grants nothing the press does not.

## 13 Long-lived things

The queue's listeners are removed when the run's scope closes; the unread mark is cleared when the run reads the words or closes. A hand-off started by words forks into the runner's scope, as a press does.

## 14 Bounded resources

out: one listener per run and one mark per run.

## 15 Rollout

A run going across the deploy keeps the old behaviour until its thread's next run.

## 16 Failures

- Words accepted by a process other than the one driving the run are readable only when that run reconciles its queue at a step boundary, so they cut no wait. Tagma serves each thread from one process, so this does not arise today.
- A hand-off whose owed row cannot be written leaves the call in the foreground ([[6c8f9ea4]]), and the words wait for it as now.

## 17 Observability

A way-making stop reads in the call's record `detail` with its reason, and in the transcript as a `wait-ended` answer; a hand-off reads as the tool's receipt.

## 18 Divergences found in building

1. **The body declares the watch, not the tool.** §4 and §5 put `watches(input)` on `Tool`. Built: the operation entry carries `watches(input)`, and the native door calls the call's own progress (`CallProgress.watch`) before the body runs. `tool.ts` and `AgentToolDoor.ts` stand over the file-size ceiling ([[6b3210c7]]) and may not grow, and the call is the owner that acts on the mark.
2. **The sleep refusal is the managed road's.** The local road has no background, so a line that only sleeps runs there as before ([[44bd57ac]]).
3. **No unread mark is kept.** §10, §11 and §13 name a `readable` port and a mark the call owner clears. Built: the port is `arrivals` (`subscribe` and `unread`), and the call owner reads the run's unread words live from the queue, so words read or taken back stop counting at once and nothing is cleared ([[49fc985b]]).
4. **[[dc751092]] and [[cd67b06f]] are not rewritten.** What Stop waiting tells the model is [[2a2f709c]]; the queue's notice to the run is [[4ad467af]]. Both claims still hold as written.
