---
id: 01a17aed-c2a9-727a-a27e-a3b8b67d7441
title: "An agent does not hold its run for its background command or call: their end always wakes it, and there is nothing to wait on them with"
ord: 76
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92913ae88b52
  - kind: relates
    to: 01a164a9-cf51-742c-9d01-4d1c205923ca
  - kind: relates
    to: 01a1696f-9c19-712f-abc1-abc6d5c27a25
sources:
  - kind: dir
    ref: apps/tagma/server/src/native-harness/keepWarm
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/callEndings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/commandEndings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/signals.ts
  - kind: symbol
    ref: packages/agent-tools/src/CommandWork.ts
    symbol: IN_BACKGROUND
  - kind: symbol
    ref: packages/agent/src/collaboration/reporting.ts
    symbol: reportOwed
---
**Today.**
- Its own command's end (`threads/collaboration/commandEndings.ts`) and its own background call's end (`threads/collaboration/callEndings.ts`) wake an idle thread through `wakeUnlessCold` (`threads/collaboration/signals.ts`). A thread whose cache is "cold" per `cacheWarmthOf` does not wake. "Cold" is either factual — the promised deadline expired, compaction, model or account change — or a guess: for providers with no promised deadline the state comes from this machine's curve or a baked-in prior estimate (`packages/agent/src/thread/cache/ThreadCacheWarmth.ts`).
- Keep-warm (`native-harness/keepWarm`) keeps an idle thread warm only while its descendants run. Its own running command or background call does not count as waiting.
- A child's fallback report (`reportOwed`, [[205923ca]]) awaits only reports of dealt-out work. A child that ended a run for the duration of its own tests reports to the parent before the work is done.
- So the only way to reliably continue work after a long command is to hold the run: `wait_command`, `wait_call`, `read_output` with `wait`. The product itself advises it: the backgrounded-command notice ends with "wait_command waits on it" (`IN_BACKGROUND`), and a wait interrupted by operator words reminds that the work "keeps running" (`WAIT_UNTOUCHED`). Holding saves nothing: while the call waits no requests go to the model, and the cache cools just the same. But an open run turns every operator message into an amendment inside the waiting loop: the agent "works" while doing nothing, and the operator's question drowns in the resumed wait.

**Will be.**
1. Its own command's end and its own background call's end always wake the thread — on any provider, in any cache state. The agent stopped for this result; continuing would have cost the same had it held the run. `wakeUnlessCold` goes away.
2. An idle thread owed the end of a running command or background call counts as waiting for keep-warm — the same as a thread with a running child. Pings only on a promised cache deadline, as now; where no deadline is promised, the cache is not considered. Keep-warm asks the owners whether "the thread is owed an end" — executions for commands, threads for calls — and does not derive the fact itself.
3. A child's running command or background call holds its fallback report the same as an awaited report of dealt-out work: the work ends in the run that reads their end. An explicit final answer from the child leaves at once, as now.
4. There is nothing to wait on a background command or call with: `wait_command`, `wait_call` and the `wait` parameter of `read_output` are deleted — it reads what has accumulated at once. What stays is `waitMs` on `bash` — a short foreground command whose result is needed now — and `wait_terminal`: a terminal never ends, that is a different case.
5. Texts Tagma lays down for the agent name what there is:
   - `IN_BACKGROUND` and `inspect` (`executions/worlds/managed.ts`): the end will arrive here and wake; `read_output` reads what was printed. A ready call prints the notice only for `read_output`, and `read_output` on `shell` becomes a direct tool ([[1d85e344]]: a direct tool's satellite is direct itself). `stop_command` and `change_command_limit` no longer name the notice: today it prints their call even though they are deferred, and the model executes it with no definition — `No such tool available`;
   - `threads/doctrine/deciding.ts`: the "An operator message is a turn boundary" line names a mechanism that does not exist; the duty to answer the operator's question before any other act stays;
   - the rule about children in `packages/agent/src/collaboration/CollaborationVoice.ts` extends to one's own command and background call: do not hold the run, continue independent work or end the run;
   - `WAIT_UNTOUCHED`, descriptions and mentions of the deleted operations in skills, doctrine, tool descriptions and the retired list.
6. Feature [[3ae88b52]] is rewritten for awaiting one's own commands and calls; [[d5c27a25|the deferred-tasks idea]] — without `wait_command` as a working way.

**Why this way.** A command's end is a fact ([[7609a86c]]), and it arrives on its own. Holding the run for it is a second delivery mechanism for the same fact ([[dd380bf6]]), and the difference between the mechanisms exists only because the first does not wake a cold thread. The cache decides the price of continuing, not whether to continue.

**Outside this work.** Tasking a thread for a time ("look in a minute", "check every hour") — [[d5c27a25]], separately.

**Acceptance.**
- A thread whose cache is "cold" by curve or prior estimate wakes on its own command's end and its own background call's end. The test goes through the same delivery and is red on the old code.
- Keep-warm for an idle thread with a running own command on a promised cache deadline schedules a ping, not `not-waiting`; with no promise — `no-promise`.
- A child that ended a run while its own command runs does not report to the parent; the report leaves at the end of the run that read the command's end.
- `wait_command`, `wait_call` and `read_output.wait` exist in no door; no text Tagma lays down for the agent names them.
- Server, app and affected-package typechecks are clean, affected tests green.
