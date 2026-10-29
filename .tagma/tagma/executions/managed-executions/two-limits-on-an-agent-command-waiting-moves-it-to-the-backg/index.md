---
id: 01a126d8-6256-72d0-b15a-4629c0dbf580
title: "Two limits on an agent command: waiting moves it to the background, life kills it; both change through command rules, the agent gets truthful words about the outcome"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/ruleResolution.ts
  - kind: file
    ref: apps/tagma/server/src/executions/commands/times.ts
  - kind: file
    ref: apps/tagma/server/src/executions/contract/wire/commandRules.ts
  - kind: file
    ref: packages/agent-tools/src/CommandWork.ts
---
Goal: an agent command has two distinct limits. **Wait** — how long the agent holds the command in place; when it expires, the command moves to the background. **Life** — how long the command may run at all; when it expires, the command is killed. Both change through one mechanism per machine, project and thread, and for every outcome the agent gets truthful words about what happened and what to do next.

## What stands now

- **One limit answers two questions.** The command rule (`write_command_rule`, three lists: machine, project, thread) sets the time after which the command is killed. The rule doesn't distinguish a foreground command from a background one, so it cuts both. The operator has two 5-minute rules (`55730eb7` on the machine, `48b52ea8` on the project), and a 20-minute background build never lives to see the end.
- **A foreground command dies instead of moving to the background.** A test needing 6 minutes is killed at minute 5, the work is lost, the agent starts it again. Example: thread 01a12660-dbc3-70fa-b84b-c55e56bcec26, `sqlite3 … dbstat` killed at 280 s.
- **Three mechanisms set the default:**
  - the `command.defaultMs` setting (10 minutes, `executions/contract/wire/terminalBehavior.ts:226`);
  - command rules;
  - one act's ceiling `LONGEST_ACT_MS` (10 minutes, `commands/times.ts`).
  The setting's own description explains that over 10 minutes it acts only on the background.
- **Backgrounding already exists**, but only on the operator's word: `AgentCall.makeWay` → `handOff` (`packages/agent/src/agent/AgentCalls.ts`). There is none on time expiry.

## Decision

### Two limits

| Limit | Default | How much the agent may ask | On expiry |
|---|---|---|---|
| wait (`wait`) | 3 minutes | up to 10 minutes | the command moves to the background through the same `handOff` as on the operator's word |
| life (`life`) | 1 hour | up to 6 hours | the command is killed; the agent gets a notification |

- **3 minutes** fit almost any check, typecheck and single-package tests on a weak machine. That is also less than the 5-minute life of the model's prompt cache, so an agent returning to the answer reads context cheaply.
- **10 minutes** is the current ceiling of one agent act (`LONGEST_ACT_MS`); no wait runs longer than it.
- **1 hour** covers builds, full tests, installs and heavy runs, and a hung command never loads the machine past an hour.
- **6 hours** is for long downloads and whole-database runs. Anything longer, or meant to live permanently, is launched as a terminal.

The numbers were approved by the operator on 2026-10-10.

**The agent in the `bash` call.** One value per limit:
- wait — `0` means straight to the background; there is no separate `background` flag beside it;
- life.

The parameters are `waitMs` and `lifeMs`, in milliseconds, like `wait_command`'s `waitMs`. `bash` declares `ownWait`, so the door adds no shared `background` flag to it. In a world with no execution host (`local`) the command is killed on the smaller of the two limits, and `waitMs: 0` refuses there.

**What obeys neither limit.**
- A terminal (`start_terminal`, `lifetime: held`) — neither wait nor life: it is a process that lives until closed.
- `inspection` and `commit-step` calls never move to the background; they have only life.
- Rules on programs (`program`) limit the process's life, as now.

### One mechanism for change: command rules

- **A rule gains a `wait` or `life` measure.**
  - A rule without `program` for `bash` — either measure;
  - for `inspection` and `commit-step` — only `life`;
  - a rule on a program — only `life`.
- Resolution order doesn't change: within one list the last matching rule decides, across lists the smallest wins. A rule shortens the time the agent named, and replaces the default when the agent named no time.
- The defaults (3 minutes, 1 hour) and ceilings (10 minutes, 6 hours) are the `COMMAND_WAIT` and `COMMAND_LIFE` constants of the command contract `packages/agent-tools/src/CommandWork.ts`: both the schema with the `bash` description and the server read them, and the server cannot import `agent-tools`.
- A `wait` rule without `through` binds only `bash`: other tools have no wait. A rule above its measure's ceiling refuses at write time (`command-rule-measure`).
- A foreground command no longer has the host `foregroundMs` ceiling: its life is one in the foreground and the background, and moving to the background doesn't touch its term.
- Backgrounding on wait expiry first moves the command's mode in the server registry to `background` (`ManagedCommands.background`), and only then the call's `handOff`: otherwise the run's Stop, which stops its run's foreground commands, would kill a command that just moved to the background. A Stop arriving while `handOff` records the call's debt leaves the call in place.
- Words about expired life take the term standing at the moment of the end (`CommandRun.standing`, `ManagedCommands.deadline`), not the term at start: the operator may have changed it. A life-limit stop says "stopped", and names unconfirmed process cleanup separately (`cleanupWords`).
- The `command.defaultMs` setting is deleted: the default is set by a rule ([[acb620dd]]). The migration step carries the setting's set value into a `life` rule of the same scope: user → machine, project → project.
- Migration marks existing rules `life` — today they kill the command, and that is their meaning.
- The operator's two 5-minute rules are deleted when this change lands: that is his decision.

So "1-minute wait on this thread" is a `wait` rule in the thread list, and "30-second wait for all projects" is a `wait` rule in the machine list. Both are written by `write_command_rule`, read by `read_command_rules`, and the agent does it on the operator's word.

### What the agent gets

Every outcome gets the same words wherever it happens, and one vocabulary: wait and life. The implementer reduces "timeout", "limit", "deadline", "envelope" and "budget" in tool descriptions, answers, notifications and app rows to this vocabulary or to the value they actually name.

- **Wait expired.** The call's answer:
  - the command runs in the background, here is its address;
  - the result will arrive by notification when it ends;
  - don't launch it again and don't wait on it with `sleep`;
  - `read_output` can peek at the output, and `wait_command` waits further.
- **Life expired.** The notification:
  - the command was killed on the life limit, what it was and who set it (the default, a rule with its words, the agent itself);
  - the output tail;
  - if the work needs longer — launch with a larger life limit, up to the ceiling, or as a terminal.
- **The command ended on its own** — the current end notification with the exit code.
- The **`bash` description** says how to choose: a foreground command with a wait; background for work with an end whose result is needed later; a terminal for a process that must live.
- **`write_command_rule` and `read_command_rules`** name the rule's measure; the answer names which value applies to the call and where it comes from.

### The app

- A background command's row shows life time and its limit (`CommandStatus`: `12m / 1h`).
- A foreground command's row shows wait time and its limit.
- The limit button on a command (`CommandActs`, `LimitEditor`, the Load row) changes its life, and the hint says so. `CallControls` edits the limit of a call without a command.
- There is no command-rules window in the app; each rule's measure is named by the `write_command_rule` and `read_command_rules` answers and the rule list at the turn's start.

## Layers

- `apps/tagma/server/src/executions`:
  - `contract/wire/commandRules.ts` (the rule's measure), `commands/ruleResolution.ts`, `commands/times.ts` (two limits, constants);
  - `store/standingRules.ts` and the migration step (measures on existing rules, setting carry-over);
  - `operations/commandRules.ts` (descriptions);
  - `contract/wire/terminalBehavior.ts` (the `command.defaultMs` setting is deleted);
  - command-end notifications (`commandEndings.ts`).
- `packages/agent-tools`: `CommandWork.ts`, `bash` — waiting on the wait limit moves to the background, life is the host deadline.
- `packages/agent/src/agent/AgentCalls.ts` — backgrounding on wait expiry through the same `handOff`.
- `packages/agent/src/agent/tool.ts` — `ownWait` on the tool declaration.
- `apps/tagma/app`: `CommandStatus.svelte`, `CommandActs.svelte`, `LimitEditor.svelte`, `LoadLeaf.svelte`.

## Acceptance criteria

The implementer proves:
1. A foreground command running past the wait limit moves to the background and is not killed; the call's answer carries the "wait expired" words; when the command ends, one notification with the result arrives.
2. A background command running past the life limit is killed; the notification names the limit and its source.
3. Limit resolution: defaults, `wait` and `life` rules in each of the three lists, an agent value below and above a rule, the 10-minute and 6-hour ceilings.
4. Migration: existing rules gain `life`, the `command.defaultMs` setting value becomes a rule of its scope, the setting is gone.
5. `inspection`, `commit-step` and a rule on a program refuse the `wait` measure.
6. A terminal obeys neither limit.
7. `rg` over tool descriptions, notifications and app rows finds no old limit words where they name wait or life.

Tests follow the "test guards the contract" rule; time uses fake clocks, no sleeps.

## What the operator checks

This is not a task-closing condition.
- Ask the agent to run tests for 5–6 minutes: after 3 minutes it says the tests moved to the background and keeps working; when they finish, a notification with the outcome wakes it.
- Tell the agent "1-minute wait on this thread" and "30-second wait for all projects": it writes the rules, and the next long command moves to the background on those terms.
- Launch `sleep 7200` in the background with default life: after an hour the command is killed, the agent gets a notification with the cause.
