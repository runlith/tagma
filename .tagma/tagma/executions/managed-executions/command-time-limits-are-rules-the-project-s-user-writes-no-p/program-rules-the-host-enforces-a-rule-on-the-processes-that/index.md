---
id: 01a0cfa1-81c1-714d-83d1-1b6713e3cf43
title: "Program rules: the host enforces a rule on the processes that actually run, proven to belong to the command"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/execution-host/src/CallLifetimes.ts
  - kind: file
    ref: packages/execution-host/src/strayProcesses.ts
---
## Outcome

A rule that names a program bounds the programs that actually run, wherever they came from. Examples: a `tsc` that `bun run check` starts, the test in `bun test && git commit`, a `vitest` run by `node`.

The execution host watches each running command's processes and ends a matched one when its rule's time is out. Stage 1 of [[8cb4e34f]] already stores the rule shape; this decision adds stage 2 (a process reader) and stage 3 (enforcement), and until stage 3 lands a program rule is refused at write.

## Problem, and what holds now

- **Text misses the real work.** Matching the typed line misses what a script starts, lines built from variables or wrapped in parentheses, and the parts of a compound line.
- **The host has only a `ps` reading.** It sees the processes around an execution through `ps` (`strayProcesses.ts`, `darwinProbe.ts`). That reading flattens the arguments into one line, gives start times to the second, and has no working folder.
- **Stops sample strays late.** A stop samples the strays outside the leader's group only once the stop begins, and recognises them again by their command text.
- **Only the leader is identified** ([[0f1ddc0b]]), and [[69128217]] forbids acting on a pid whose identity was not proven.

## Target model

**The reader.** A port with one implementation per platform; macOS is the only one now, since the host runs nowhere else.
- **What it reads** for each process: pid, parent pid, arguments (`sysctl(KERN_PROCARGS2)`), executable path and working folder (`proc_pidinfo`), and a start witness.
- **The start witness** is whatever the platform proves a process by. On macOS it is `proc_bsdinfo.pbi_start_tv*`, the creation time in microseconds.
- **Consumers.** The watcher uses the reader, and stop-time stray sampling in `strayProcesses.ts` moves onto it too, retiring its `ps` read and its text recognition.
- **`ProcessUsage` stays as it is:** an evidence reader, off the control path.

**The proven set.** For each command, the host keeps the set of processes proven to belong to it.
- **Joining.** A process joins when it is first seen as a child of the command's leader or of a member of the set, identified by its pid and start witness.
- **Staying.** It stays after its parent exits and the kernel re-parents it.
- **Reused pids.** A pid whose witness no longer matches has been reused: it leaves the set and is never signalled. So [[69128217]] is met by proof.
- **Before each signal** the witness is read again. What remains on macOS is the window of microseconds between two system calls, a known limit.
- **Stops use this set.** From stage 3, a command's stop ([[f86edb6b]]) signals its whole proven set instead of the strays sampled once the stop begins.

**Matching a process.**
- **The program word** matches the basename of `argv[0]` or of the executable. When the executable is an interpreter, it also matches the script the interpreter runs, by its basename without extension, or the module after `-m`.
  - The interpreters are named in one list: `node`, `bun`, `deno`, `python`, `python3`, `ruby`, `perl`, `sh`, `bash`, `zsh`.
  - The script is the first argument that does not start with `-` and names an existing file, relative to the process's folder.
  - A shell given `-c` has no script. Its line starts processes of its own, and those are matched as they appear.
  - An option whose value stands before the script shifts it (`node --require ./x.js vitest.mjs` matches `x`). That is a known limit, and such a program is named by its interpreter's own words.
  - So `tsc` covers `node …/bin/tsc -p x`, `vitest` covers `node …/vitest.mjs`, and `pytest` covers `python -m pytest`.
  - `cat pytest.ini` does not match, and neither does `tail -f tsc.log`.
- **Every other word** must equal an argument exactly, after the argument the program word matched, in the written order. Other arguments may stand between them.
  - So `git commit` covers `git -C repo commit -m x`.
  - It does not cover `git add docs/commit.md`.
  - `bun test` does not cover `bun run scripts/test.ts`.
  - A known over-reach: `git log --grep commit` matches `git commit`.
- **Folder.** A rule's folder is relative to the thread's project root, compared after resolving real paths on both sides against the process's working folder. It covers that folder and everything below it, so `make -C x` matches where it runs.
- **Rematching.** A match is computed again whenever the process's executable, arguments or folder change, as on exec or chdir, so a shell that execs `bun test` is matched as `bun test`.
- **Why rules still read text.** Text in the arguments only chooses a rule. Which execution a process belongs to still comes from kernel ancestry, as [[62049465]] requires.

**What a program rule bounds.**
- **Order.** Program rules form their own ordered list per thread: the project's first, then the thread's own. The last one that matches a process decides that process's limit.
- **When the clock starts.** A process's time counts from the round that first matched it. So a shell that did other work before exec'ing into a matched program is charged only from the match.
- **A matched process bounds its whole subtree.** A descendant that matches a rule of its own is bounded by that rule as well, but it still ends when its ancestor's limit runs out, so nesting can only shorten. Take "make → 5 min" over a "cargo test → 30 min" child: the cargo test ends with make at 5 minutes.
- **Ending.** When a limit runs out, the matched process and its proven subtree go through the ladder of [[f86edb6b]].
- **The rest of the command** runs on under its own whole-call limit.

**The default yields to program rules.** This applies to a call whose current deadline came from the default: origin `default`, read from the latest revision, per [[8cb4e34f]].
- **What the watcher keeps it at.** Each round, the watcher sets the deadline to the later of two instants: the default's own, and the latest end of any live covered process's limit.
- **When it revises.** It revises as soon as a covered process is first matched, not at the last moment, so a delayed or failed round near the default's instant decides nothing. It revises down again when covered processes exit, never below the default's own instant or the present, so the call ends within a round of its last covered process.
- **Why this is legal.** The revision is an ordinary one, made before the deadline's instant, so `CallLifetimes.ts` keeps its law that a deadline decides at its instant. Revising a command without a ceiling is stage 1's change in [[8cb4e34f]].
- **Conflicts.** The revision's origin stays `default`, and its cause is `rule`. A caller who then changes the limit is told it is stale, and the caller's own revision turns the origin into `caller`.
- **What never yields:** a caller's own time (`caller`) and a whole-call rule's time (`rule`).

**Rounds.** The watcher lives in the host, so it survives a server restart for as long as the host stands. It walks each running command once a second, from the leader and from every live member of the proven set.
- **Overrun.** A limit is overrun by at most one round plus the ladder. One second is under 4% of the shortest limit in the examples (30 s).
- **No overlap.** Rounds never overlap. A round longer than the period delays the next, and the host's status counts it.
- **Cost.** Stage 2 measures the cost of a round, and the period is revised if that cost demands it.

**What the caller hears.** The answer, and a background command's ending notice, name:
- every process a rule ended, with its rule;
- every process that could not be ended or read.

## Owners and boundaries

- **The host:**
  - the reader port and its macOS implementation, in the native crate `packages/execution-host/native`;
  - the proven set and the watcher, in `ExecutionRegistry.ts` beside the command's lifetime;
  - stray sampling on the reader (`strayProcesses.ts`);
  - extension revisions through `CallLifetimes.ts#revise`.
- **The wire:**
  - admission carries the program rules copy, in `packages/executions/src/protocol/command.ts`;
  - the summary carries per-process endings, in `protocol/stop.ts` and `ExecutionSummary`.
- **The server:**
  - resolution of program rules at admission, in `terminals/commandPolicy.ts`;
  - the write operation stops refusing program rules;
  - overlap answers for program rules. Two program rules overlap when their program words are equal, the words of one are a subsequence of the other's, and one folder contains the other.
- **The tool:** the answer names per-process endings (`ShellRun.ts`).

## Rejected

- **Matching the typed text,** for the reasons above.
- **Charging from the fork time.** A shell that runs for minutes before exec'ing would reach its match already late.
- **Relaxed matching for every word.** `git commit` would match `git add docs/commit.md`.
- **Letting a descendant outlive its ancestor's limit.** A build step would outrun the build's own budget.
- **Ending the default at its instant and reading the tree then.** That would break `CallLifetimes.ts`'s law that a deadline decides at its instant.

## Contract

The wire rises once in stage 3, counted from whatever stands when it lands.
- Admission gains the program rules copy.
- The summary gains per-process endings: process, rule, and the ladder step it ended at.
- Nothing changes in stage 2, whose reader is internal to the host.

## Stored data

- **The server's command record** keeps the program rules copy with the whole-call copy of [[8cb4e34f]].
- **The host's stored summaries** gain per-process endings. Rows written before this decision are read without them.
- **Rollback** is forward-only, with the release.

## Who may do what

Out: program rules go through the same gate as every rule in [[8cb4e34f]]. The watcher acts as the host, on processes proven to belong to a command.

## Long-lived things

- **A command's proven set and watcher** start at admission and are dropped when the command is decided.
- **A process that left the tree before any round saw it** is outside every rule, and the residual disclosure names what is known of it.

## Bounded resources

- **Size of the proven set.** A command's proven set is capped where one round over it would take half the period, at the per-member cost stage 2 measures on this machine.
- **At the cap,** new members are not proven, the command's read says so, and program rules no longer reach what is not proven.
- **Cost of a round.** Each round costs one reader call per live member.

## Rollout

- **Stage 2** changes the host only, so it takes an idle replacement.
- **Stage 3** raises the wire, so it lands through a restart while no execution is live, as [[8cb4e34f]] states.

## Failures

- **A process whose arguments or folder cannot be read** matches nothing. The answer names it as not read.
- **A failed round** applies no program rules for that round, and the read shows the gap.
- **A host replaced during a ladder** ends the work through the replacement.

## Observability

- **A command's read** shows its program rules copy, the size of its proven set, whether the watcher is watching it (and if not, why), and each process a rule ended.
- **The host's status** shows rounds, their duration, and every delayed, skipped or failed round.

## Known limits

- **Platform.** Program rules need the host, which runs on macOS only. Linux and Windows add a reader implementation of their own, with their own start witness, when a host runs there.
- **The macOS window.** Signalling on macOS leaves a window of microseconds between re-reading a witness and signalling.
- **Double forks.** A double fork completed before the first round sees it escapes.

## Order of building

1. **Stage 2.** Build the reader port and its macOS implementation, move stray sampling onto it, and measure the cost of a round.
2. **Stage 3.** Build the proven set and the watcher, then:
   - matching, the rules copy and extension revisions;
   - per-process endings on the wire and in answers;
   - the stop over the proven set;
   - lifting the write refusal for program rules.

## Acceptance

All criteria hold on the admitted road on macOS.
1. A project rule "`tsc` in `apps/api` → 60 seconds":
   - the `tsc` that `bun run check` starts in `apps/api` gets its first stop signal within one round after 60 seconds from its match, and is gone with its subtree within the ladder;
   - a `tsc` in `apps/web` runs on;
   - the answer names the process and the rule.
2. A project rule "`bun test` → 20 minutes": a call with no timeout running `zsh -c 'cd x && bun test'` lives past the 10-minute default until `bun test` ends. Neither the shell nor the test's workers are ended at the 10-minute mark.
3. A call on the default whose covered process exits early ends at the default's instant if that has not passed yet, or else within one round of the exit. The watcher's downward revision shows this.
3a. A round delayed past the default's instant does not end a call whose covered process still has time left, because the extension was made when the match was first seen.
3b. After a caller revises a default call, the watcher no longer extends it.
4. Rules "`bun test` → 20 min" then "`git commit` → 30 s": `bun test && git commit -m x` gives the test its own time and ends only the commit at 30 seconds.
5. Matching, with an injected reading:
   - `sh -c 'sleep 1; bun test'` is matched when the shell execs, and is charged from that match;
   - `git add docs/commit.md`, `bun run scripts/test.ts` and `cat pytest.ini` match no rule;
   - a process that changes folder into a rule's folder is matched there.
6. Ordering and nesting: a thread's program rule placed after a project's program rule decides for that thread. "make → 5 min" over "cargo test → 30 min" ends the cargo test with make.
7. Proof: with an injected reading, a proven process whose pid is reused is never signalled, and a re-parented member is still ended.
8. With an injected reading, a rule written after a command starts does not bind it.

## Claims and tasks this touches

Re-read at close: [[0f1ddc0b]], [[017cff32]], [[62049465]], the claims over `CallLifetimes.ts` about deadlines, and the claims over `strayProcesses.ts`.

Rule [[69128217]] stands, and is re-read against the proven set. No open task touches this change.
