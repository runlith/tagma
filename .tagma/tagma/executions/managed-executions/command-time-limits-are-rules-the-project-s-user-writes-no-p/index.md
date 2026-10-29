---
id: 01a0cf38-b201-7723-b919-48c38cb4e34f
title: Command time limits are rules the project's user writes — no profiles, no figures nobody chose
ord: 52
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/policy.ts
  - kind: file
    ref: apps/tagma/server/src/executions/contract/wire/commands.ts
  - kind: symbol
    ref: packages/agent-tools/src/bash/tool.ts
    symbol: createBashTool
---
## Outcome

How long an agent's `bash` work may run is set by rules the project's user writes, and profiles a model picks or figures nobody chose no longer decide it.

- **Without a rule,** work runs for the time its caller named, or for the default when it named none.
- **Rules are project data.** Tagma ships none. A rule belongs to one project in one installation, written from the user's own words.
- **This decision** holds the rule model and its first stage: the default, `none`, whole-call rules, and the removal of the profiles and the workload queue.
- **Rules on the programs that actually run** (a `tsc` a script starts, one part of `bun test && git commit`) arrive in stages 2 and 3, decided in [[13e3cf43]].
- **Stopping** is decided in [[f86edb6b]], which lands with stage 1.
- **Platform.** Only macOS is used today, and the execution host runs only there (`packages/execution-host/native/src/lib.rs`). Nothing here is macOS-specific except what [[13e3cf43]] reads.

## Problem, and what holds now

Each point is checked against the code.
- **The 2-minute default** in `packages/agent-tools/src/bash.ts` was copied from OpenCode in `1d5a01f728`.
- **The profiles carry no recorded reason.** They are `one-shot` (10 min), `heavy` (5 min), `support` (30 s) and `service`, in `protocol/commandPolicy.ts#shippedProfile`. The model picks among them, although the policy that introduced them promised otherwise, and nothing tells it what a profile means: `heavy` runs shorter than `one-shot`.
- **The workload queue measures neither memory nor CPU** (`packages/execution-host/src/CommandAdmission.ts`).
  - Its memory figures only size counts; the 562 MB "checker worker peak" is actually the peak of one `bun test askRoad.itest.ts` run on 2026-09-17.
  - No production caller declares a fan-out or lends a workload, and only the model's own choice marks work heavy.
  - On this 12-core machine it enforces 48 ordinary commands at once, one `heavy` at a time among agents that chose `heavy`, and waits of 5 s and 10 minutes.
  - Its quarantine caused an outage on 2026-09-17 and was removed on 2026-09-18 (`8928a017c8`).
- **An agent thread adopted the shipped values,** not the operator.
- **Two gates hang on the workload.** A managed world sends commands to the host only when the host's offered policy declares a workload (`managedWorld.ts`: `offered.success.workload !== undefined`). `ServingGit` takes the admitted road on the same condition.
- **The host refuses to revise a command with no ceiling.** `CallLifetimes.ts#revise` answers `not-a-command` when the call was opened without an admitted ceiling.

## Target model

**The default** is one setting: how long work runs when its caller names no time.
- The operator chose 10 minutes on 2026-09-23. It ships as the setting's fallback with that reason, set for the machine and overridable per project.
- It applies to foreground and background work alike.
- **The tool sends a time only when the caller named one.** A command's current deadline carries where its time came from: `caller`, `default` or `rule`. A revision records its own origin, so a caller's revision turns the origin into `caller`. This is how the server, the host and [[13e3cf43]] tell a caller's own time from the default.

**A rule** is a record with a fixed shape: data, never code.
- **Id:** the server mints it at write, and the write's answer returns it. Anchors and removal refer to it.
- **Reach:** the project (every thread in it) or one thread.
  - A thread's rule binds that thread alone; whether it should reach the agents the thread starts is open in [[262324c5]].
  - Acts the operator takes from the app belong to no thread, and no rule reaches them.
- **Through** (optional): the tool whose call started the work.
  - Every launch request names its tool: `bash` for the shell tool, and the operation's own name for a Tagma operation such as `submit_work`.
  - In this decision rules reach only launches whose tool is `bash`. An empty "through" means every tool that rules reach, which here is `bash` alone.
  - Tagma operations join through [[1b104ee8]] without any change to the rule's shape.
- **Program** (optional): words and a folder. A rule with a program is enforced by [[13e3cf43]], and until its stage 3 lands, a write naming a program is refused with that reason. The shape stands from stage 1, so no rule is rewritten later.
- **Limit:** a time.
- **Origin:** the thread that wrote the rule, when, and the words it gave as the user's. The origin is kept as text, so a project rule outlives the thread that wrote it.

**Whole-call rules.** A rule without a program bounds whole tool calls and nothing else. It never takes part in matching processes, so a thread's "any `bash` → 30 minutes" does not silence a project's program rule.
- **Order.** The project's whole-call rules come first, then the thread's own, forming one ordered list per thread. The last rule that matches a call decides its limit.
- **Lowering only.** A caller's own time is never raised: the rule may only lower it. A call that names no time takes the deciding rule's limit in place of the default.

**Writing and reading rules.** Three operations:
- **`write_command_rule`** takes the reach, an optional through, an optional program, the limit, the origin's words, and a position: before or after a named rule of the same list, or at the start or end of that list.
  - It answers the new rule's id.
  - A write whose named anchor is gone, or stands in the other reach's list, is refused.
  - Writes at the start or end land in the order they commit, and each answer names the rules it then overrides and the rules that override it.
  - Two whole-call rules overlap when both could match one call, that is, when their through fields are equal or either is empty.
- **`remove_command_rule`** takes a rule's id.
- **`read_command_rules`** answers, in order, the rules standing over a thread or a project, paged under a derived default and ceiling ([[68659e3b]]).

Every agent shows the user the rule it wrote and what the write answered. There is no reorder operation: a rule moves by being removed and written again.

**The write gate.**
- **Mounting.** The graph capability mounts the three operations, so they reach every thread that holds the graph, whether or not its checkout is shared. This holds from [[270d1e2b]] on, the change that makes rules bind calls. Until then nothing offers a rule to an agent, and only the operator's HTTP door and `tagma op` serve the operations ([[bb55910d]]).
- **Review and trust.** The capability's floor asks the user about writes and removals, placed beside `settingsPermissionFloor`. An unattended child running under trust is refused as unattended.
- **Bypass** asks nothing: the operator said on 2026-09-23 that bypass means the work is trusted to the agent. That includes removing or overriding the user's own rules.

**Where rules live.**
- **Storage.** Rules are kept in a table of their own. Its reach column cascades on the thread, and its origin does not.
- **The command record** keeps a copy of the rules that applied, text and origin included, for as long as the record is retained. A command's read shows that copy.
- **Delivery.** A thread learns its rules at the start of its session and whenever they change, as a section of its turn context. The section carries one compact line per rule: id, reach, through, program and folder, and limit. The origin's words stay in `read_command_rules`, because the section is re-sent whole on every change ([[98bb2ff1]]). A rule written mid-turn binds the next call, and that call's answer names it.

**Roads.** `bash` runs either on the admitted road, where the host holds the command, or on the local road (`local()` in `bash.ts`), which the platform world, a managed world while no host stands, and the docker sandbox use.
- **Both roads take the default and whole-call rules.**
  - **Admitted road:** the server resolves them at admission.
  - **Local road:** nothing is admitted, so the tool resolves them through a server port on every call. A rule written mid-run is seen either way.
- **The managed world** sends commands to the host whenever the host offers the command road. That replaces the gate on a declared workload.
- **After a server restart** a local child keeps no deadline, because it is spawned detached; that is a known limit.

**No limit.** `timeout: "none"` is taken only with `background: true`, so it exists only on the admitted road (the local road refuses `background`).
- A foreground request for it is refused in one sentence.
- Whole-call rules still bound it.
- It ends when it is stopped, when its thread is deleted, or when its host is replaced. While any process of its tree still holds its output, it keeps running.
- The tool description says that `background: true` replaces a trailing `&`. A program sent off with `&` and its output redirected leaves the command's pipes, so the command ends and the program runs on unwatched.

**Changing a running command's limit.**
- **Within the rules.** A thread may lengthen or shorten its own running command within the rules copied at its start.
- **Where no rule covers it,** the command has no ceiling, and the thread may change it freely, since it could have asked for any time at the start. `CallLifetimes.ts#revise` accepts a revision of a command without a ceiling, instead of refusing it as `not-a-command`.
- **Past the rules,** only the operator's exception applies.
- **This replaces** "a thread only shortens" in `terminals/commandEligibility.ts`.

**Tagma's own work.**
- **The git behind `submit_work`** (`ServingGit`) takes the admitted road wherever the host offers the command road, instead of wherever a workload is declared.
  - Its launches name `submit_work` as their tool.
  - It runs under the default, like a `bash` call that named no time.
  - No rule reaches it until [[1b104ee8]].
  - The `support` profile's 30 s bound ends with the profile.
- **Tagma's background calls** (the checkout reading after a command, the boot probes) are not an agent's work, and no rule reaches them.
- **Service owners.** A service owner's authority is keyed on the owner itself (`CommandOwner` `Service`) instead of on the `service` profile, in `commandEligibility.ts#serviceManaged` and `CommandAccess.ts`.

## Owners and boundaries

- **The server decides policy:**
  - rules, their store and gate, and resolution at admission: `terminals/commandPolicy.ts`, `protocol/commandPolicy.ts`, `protocol/settings.ts`, `terminals/CommandAccess.ts`, `terminals/commandEligibility.ts`, `terminals/commandSubjects.ts`, `terminals/commandAdopt.ts`, `terminals/commandSetup.ts`, `terminals/commandDemand.ts`, and a new rule store beside `db/terminals.ts`;
  - records and reads: `db/terminals.ts`, `terminals/Terminals.ts`, `terminals/TerminalStore.ts`, `terminals/TerminalExecutions.ts`, `protocol/commandReads.ts`, `protocol/operations/commands.ts`;
  - git: `terminals/servingGit.ts`, `terminals/admittedGit.ts`, `terminals/admittedCommand.ts`;
  - worlds and the turn context: `harness/worlds/managedWorld.ts`, `harness/worlds/checkoutWorld.ts`, `harness/worlds/commandWork.ts`, `harness/sandbox/docker/dockerWorld.ts`, `harness/turnContext.ts`;
  - the floor: `harness/capabilities/graph.ts`.
- **The host admits without a workload:** `CommandAdmission.ts`, `ExecutionRegistry.ts`, `RunnerBinding.ts`, `host.ts`, `db/schema.ts`, `ExecutionStore.ts`. It revises a command without a ceiling in `CallLifetimes.ts`.
- **The wire:** `packages/executions/src/protocol/command.ts`, `capacity.ts`, `wire.ts`, `Executions.ts`, `ExecutionClient.ts`, `executionSpawner.ts`.
- **The tool:** `packages/agent-tools/src/bash.ts`, `CommandWork.ts`, `ShellRun.ts`, `_descriptions.ts`.
- **The app:** the workload leaves `apps/tagma/app/src/lib/features/terminals/CommandWorkload.svelte` and `CommandActivity.svelte.ts`. A screen for rules comes later, as its own task.

## Rejected

- **"The most specific rule wins".** It is undefined for two rules that overlap without one containing the other.
- **"The shortest limit wins".** It cannot give one package more time than the rest.
- **Keeping the workload queue unused.** That leaves a dormant mechanism on the wire and in the tests. Protection by measured load is kept in [[52791797]].
- **Accepting program rules before they are enforced.** A stored rule that does nothing would read as protection.

## Contract

The wire rises once in stage 1, counted from whatever stands when it lands; no number is written here.
- **`CommandLimits`:**
  - `executionMs` becomes optional, which is how `none` is expressed;
  - `executionCeilingMs` becomes optional: a whole-call rule's limit when one applied, absent otherwise;
  - `queueMs` goes, because nothing waits for admission;
  - its `stop` goes, as [[f86edb6b]] decides.
- **`CommandDeadline`:**
  - `executionMs` and `ceilingMs` become optional;
  - it gains the origin of its time (`caller`, `default` or `rule`), per revision.
- **The launch request** names its tool.
- **What goes from the wire:** `CommandWorkload` and its fan-out, the runner bindings that only fan-out uses, `WorkloadPolicy`, and `yieldWorkload`.
- **Admission** carries the applied rules' copy.
- **Operations.**
  - The three rule operations are new. `adopt_command_profile` and the `commandPolicy.*` settings go.
  - `bash` loses `profile` and gains `timeout: "none"`.
- **A server that finds a host speaking another wire** decides by the wire stamp ([[4473e762]]): it replaces the host when no work is live, and keeps it until it is replaced by hand when work is.

## Stored data

**The server migrates:**
- the `command.profile` and `command_profile` columns go;
- the rule table is added;
- the command record gains the rules copy;
- saved `command:launch:…` grants, each of which carries one launch's operation id and could never match again, are withdrawn with a reason into `thread_owner_rule_withdrawn`;
- saved rules naming `adopt_command_profile` are withdrawn the same way;
- no row is left that fails to read ([[2adc84b0]]).

**The host** reads the rows an old host stored only to discharge them, ignoring `workload`, `queueMs` and `stop`. Every field this decision adds is optional in stored rows, so a row written before the release still decodes: a missing origin reads as `caller`, and a missing rules copy reads as none.

**Rollback:** the migration is forward-only, so a previous installation cannot run on the migrated database.

## Who may do what

- **Writing a rule** goes through the gate above. If the gate is wrong, a rule is added, removed or overridden without the user being asked. Every change shows in the rule section of each reached thread's next turn, and the read names its origin.
- **Lengthening a running command past the rules** is the operator's exception alone (`change_command_limit` `exceptionMs`).

## Long-lived things

- **A rule** lives until it is removed or, for a thread's rule, until its thread is deleted (through the cascade). Archiving keeps it.
- **A command's rules copy** lives as long as the command record.
- **A `none` command** lives until it is stopped, its thread is deleted, or its host is replaced.

## Bounded resources

- **Rules per list** have a ceiling, derived in stage 1 from the cost of the turn section. A write past it is refused with the ceiling named.
- **The copy on a command** holds only the rules that applied to it: at most one whole-call rule in this stage.
- **The rules read** pages.

## Rollout

- **Releases and the wire.** A release raises `WIRE_VERSION` at most once. A release that raises it lands through a restart while no execution is live. Two releases ready together may share one replacement. [[7aec9851]] states the same.
- **Work that never ends.** A standing `none` command keeps a restart from finding the host idle. The restart names the work holding it ([[32240cd7]]), and the operator ends that work or takes the immediate road, which ends every command and terminal.
- **Survival across replacement.** [[fb5c1b45]], running work surviving a host replacement, would make both decisions cheaper; neither depends on it.
- **Shared with [[7aec9851]].**
  - This decision owns command admission, deadlines and the command vocabulary; [[f86edb6b]] owns stopping; [[7aec9851]] owns custody, bindings and input.
  - Files both touch, where each side tells the other before editing:
    - `host.ts`, `ExecutionRegistry.ts`, `db/schema.ts`, `ExecutionStore.ts`, `protocol/wire.ts`, `Executions.ts`, `ExecutionClient.ts`, `executionSpawner.ts`;
    - on the server, `Terminals.ts`, `TerminalExecutions.ts`, `terminalsLayer.ts`, `protocol/operations/terminals.ts`, `api/terminals.ts`;
    - the app's terminals feature;
    - `packages/llm/src/capture`.
  - Saved approvals: each side withdraws its own.

## Failures

- **A write whose anchor is gone** is refused.
- **A rule removed while a command runs** leaves the command's copy standing.
- **A server restart** leaves admitted commands running under their copied limits on the host.

## Observability

- **A command's read** shows the time it asked for, the origin of its limit, and the rules copy.
- **Each thread's turn** shows its standing rules.

## Known limits

- **Foreign shells.** The shells of foreign CLI harnesses and of external MCP sessions are not Tagma's `bash`, and no rule reaches them.
- **Unmeasured:** a 10-minute foreground default may outlast an external MCP client's own tool-call timeout.

## Order of building

Stage 1, which this decision builds, has four parts. Each lands only with its tests green.
0. **[[f86edb6b]] first.** The ladder replaces `StopPolicy` everywhere while the profiles still stand; their stop field goes with it.
1. **The vocabulary and the host,** built by one owner because it compiles only as a whole:
   - the workload and the profiles go;
   - the command limits and deadline change as the Contract says;
   - the host admits without a workload and revises commands without a ceiling;
   - the managed world and `ServingGit` lose the workload gate;
   - the settings, the migration and the app follow.
2. **Rules:** the store, the three operations, the floor, the turn section, resolution at admission and on the local road, and the command's rules copy. This part can be built beside part 1 and is joined to it at admission.
3. **The tool:** a time is sent only when named, `timeout: "none"` is added, and the description states the default and `none` and that `background: true` replaces `&`.

Stages 2 and 3 are [[13e3cf43]].

## Acceptance

Criteria 1 to 3 and 7 to 9 hold on both roads. The rest hold on the admitted road.
1. A `bash` call with no timeout runs under the default setting, and the tool description states it.
2. A thread rule "any `bash` → 5 minutes":
   - a call that asks for 600000 ms runs under a 300000 ms deadline, and the answer names the rule;
   - a call that asks for 60000 ms keeps 60000 ms;
   - another thread's calls are unaffected.
3. Rule order: given a project rule "any `bash` → 20 minutes" and a later thread rule "any `bash` → 5 minutes", a call with no timeout in that thread runs under 5 minutes, and in another thread under 20.
4. `timeout: "none"`:
   - with `background: true` it runs with no deadline, and its read says so;
   - without `background` it is refused.
5. Changing a running command's limit:
   - a thread lengthens its own running command within a whole-call rule, and is refused past it;
   - with no rule, it lengthens the command freely, and its read shows the new time with origin `caller`.
6. `submit_work`'s git runs admitted where the host offers the command road, under the default. A whole-call rule with an empty "through" does not reach it.
6a. A command's read shows the time it asked for, the origin of its current limit, and its rules copy.
7. Rule writes:
   - a rule write asks the user under review and trust, and asks nothing under bypass;
   - a write naming a program is refused with its reason;
   - a write whose anchor is gone is refused;
   - a write past the ceiling is refused with the ceiling named.
8. Rule lifetimes:
   - a thread's rules are gone when the thread is deleted;
   - a project rule stays when the thread that wrote it is deleted;
   - a command started before a rule was written keeps its own copy.
9. A thread's turn context carries its rules at session start and after every change, and the read answers the same list.
10. Nothing of the old policy remains:
    - no command profile, no `profile` parameter, no workload class or slot, anywhere in the tool description, the settings, the stored rows, the permission subjects or the code;
    - a command starts without an admission wait.

## Claims and tasks this touches

Tasks [[26641770]] and [[b8f0f683]] are in work on `host.ts#refusalOf`, held by another session. The removed workload refusals fall to its default arm, so this change leaves `refusalOf` alone.

At close, re-read each claim written against the old policy and replace or withdraw it:
- [[6fa07b87]], [[596672e3]], [[ddaca9e5]], [[0139540b]], [[ea46adc7]], [[e68a617b]], [[ee50bb12]], [[df0b1abf]];
- [[28930286]], [[f3d8d42a]], [[7e1b2dd3]], [[e7950af9]], [[9f38947e]], [[a7509fcc]], [[4ac3201f]], [[30cd3749]], [[eb223bc8]], [[422d6a64]], [[ba7207ab]];
- [[ffe5e21c]], [[96039e2a]], [[8ab4c82d]], [[f0eb4180]], [[c081d600]], [[08ad4a60]], [[6a07e6d9]], [[9047e38f]], [[e093cc1b]], [[6a976576]];
- [[f20c8902]], [[fdf84faf]], [[12536112]], [[2adc84b0]].
