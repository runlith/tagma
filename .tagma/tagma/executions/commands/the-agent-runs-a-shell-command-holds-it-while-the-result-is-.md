---
id: 01a14c14-6895-75c6-80f2-47b8441e23be
title: "The agent runs a shell command: holds it while the result is needed, and longer — moves it to background and gets the outcome as a notification"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9294da5d3d19
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b9a59ab4ef
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bbffb12110
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bebad9bb51
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bf37a0e8a9
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c0788868e6
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/waiters.ts
  - kind: file
    ref: apps/tagma/server/src/executions/worlds/shell/start.ts
  - kind: file
    ref: packages/agent-tools/src/bash/managed.ts
  - kind: file
    ref: packages/agent-tools/src/bash/tool.ts
  - kind: symbol
    ref: packages/agent-tools/src/CommandWork.ts
    symbol: COMMAND_WAIT
---
**Value.** Builds, tests, and typecheck neither hold the agent in place nor get lost: a slow command works on, the agent too, and its end arrives on its own.

**How.** The native agent's `bash` tool: command, working directory, wait, life, and a short description.

**Behaviour.**
- Waiting is how long the call holds the command. When it passes, the command goes to background unharmed, and its end reaches the thread as a notification and wakes it — if the turn ended on its own rather than being stopped or broken — under any cache state, including after a server restart. Zero wait answers with the command address at once.
- An end that arrived during the turn the turn reads on the next step and takes another step for it. If the turn ended without reading it, that end opens the next turn, even one the stop halted. Exception — a turn cut short by a server restart: then the end waits for the next turn. Cache warm-up does not read such an end: the turn after warm-up opens it. On native and on ACP it is the same.
- The notice waits for both the host ending and the checkout measure after the command; an outcome the agent already read whole does not come twice.
- The command is an execution of the execution host in the project inventory: visible in the feed, in Load, and in `read_commands`; while the host is busy it stands in the queue.
- A nonzero exit keeps the output and is recorded as an execution failure; a permission refusal stays a separate outcome. Failure to read one output stream leaves the other readable, while the answer discloses that its output is incomplete.
- The answer is the last output lines with the exit code and where the wait and life came from: default, call, or rule. If the answer does not carry the whole output, it names the `output.log` file in the command record: stdout and stderr in print order, the last 8 MiB, and how many bytes left if the beginning was not kept. The answer and notice of a command that was stopped wait on the facts deciding its `output` — its end or the cleanup verdict that the output is held by a surviving process — not on a term; then they either name the file or say why the output did not land as a file. So output is not diverted to a file for keeping — then the operator does not see it; the `bash` description tells the model this. When moving to background the answer separately names the process phase: a finished process does not become running because of a still unfinished observation or checkout measure. If the phase is unavailable, zero wait at once returns the command address and the reason of unavailability; no result does not prove the process still runs.
- The description shows to the operator instead of the command head; `agent.commandDescription` decides whether it is required of the model, and changes with the run opening.

**Limits.** Without an execution host — outside macOS, in a sandbox guest, or with `agent.checkoutWorld: platform` — the command lives only while the call runs: no background, zero wait refuses. What the command wrote to the checkout and whose it is, the code area judges.
