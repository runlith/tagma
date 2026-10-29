---
id: 01a0ef62-6fc1-7769-9107-f9e349826c62
title: Machine load is one status-bar button and one popover of live work — project, place, owner, execution, with Tagma's own processes and the agents' share — and the Processes section leaves
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/PaceControl.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/processes/lines.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/processes/Page.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ActivityBadge.svelte
---
## 1 Outcome

The operator reads what loads the machine from one place: a button in the status bar and the popover it opens, named Load.

- **The button.** It shows three things for the whole machine: how busy the processor is, as a share of all cores; the memory Tagma and its agents really hold; and how many commands and terminals are live. It takes a warning tone only when the machine is saturated or a process is left without an owner.
- **The popover.**
  - **The machine band.** One bar splits the processor into agents, Tagma itself, other programs and free.
  - **The live tree.** Project → place (worktree, with its tone) → owner → the owner's live commands and terminals. An owner is an agent thread with its model, the operator ("you"), or Tagma's work in that project. Rows are sorted by processor, busiest first. Owner and place rows carry a 60-second processor trend. A command row carries its elapsed time and how much of its limit it has used.
  - **The Tagma block.** Tagma's own processes stand in a block of their own: the server, its database workers, the execution host, and the processes Tagma's acts start (git and inspections). Each names the thread it works for where that is recorded.
  - **The agents' share.** Full, Low and Lowest is a control in the popover's header.
  - **Orphans.** A process left without an owner stands at the foot with one action that ends it.
  - **Only live work.** Ended work is not listed: it belongs to the thread that ran it.
- **The thread badge.** An agent's row in the thread list shows a badge only while the agent has live work: its count and the cores it takes. The badge opens the same popover, scrolled to that agent.
- **What leaves.** The Processes section, its route, filters and tabs, the badge's Active/Unknown/Recent popover, and the separate agents'-share control in the status bar.

The layout this decision fixes is drawn at http://localhost:5634/a/90f26a6ecfdd. Where the page and this text differ, this text holds.

## 2 Problem

Measured on 2026-09-29 against build e46a21b77c:

- **Processes mixes the live and the ended.** One group listed 11 lines while one of them was live. The header counted 4 lines while dozens stood on screen. A row's title is the full shell text of the command.
  - Ended work is a 200-wide newest-first window ([[6cb16dfe]]) merged into the live lines (`processes/Page.svelte`, `processes/lines.ts#ownerGroups`).
- **The badge can say nothing.** It rendered `>_ 0` and opened on "Active 0 · No active work". It carries a second view of the same lines, with Active, Unknown and Recent tabs (`threads/ActivityBadge.svelte`).
- **The processor figure is blank for most rows.**
  - `ProcessUsage.ts#rateOf` refuses a whole command's rate — `first-sample`, `interval-empty`, `identity-unproven`, `identity-changed` or `counter-reset` — when any one process of its tree fails the check.
  - A command shorter than the gap between two readings can never carry a rate.
  - On darwin the reading spawns `ps -o pid=,ppid=,pgid=,lstart=,rss=,time=` (`darwinProbe.ts`): a process per reading, and a start stamp with one-second resolution.
- **Terminals are not measured at all.** The row reads "A terminal is not sampled" (`processes/Line.svelte`).
- **Tagma's own processes are no row.** The server, its SQLite children and the host are absent. Today they were the load: the server took about one core, its four SQLite readers about 1.6 cores, and each git process 50–60 %.
  - The performance record declares `Installation` and `Machine` load subjects (`packages/performance/src/protocol/records.ts#loadSubjectSchema`). A search of `packages/execution-host/src`, `packages/executions/src` and `apps/tagma/server/src` found no producer of either.
- **Memory overstates.** The live figure is a resident-set sum ([[ed976314]]). The server read 3.4 GiB resident against 0.94 GiB physical footprint; the rest was clean, reusable allocator pages (perf-cpu's report, vmmap sample).
- **Orca is the reference and falls short where we would copy it.** Read at `.external/orca` c8937936e, `src/main/memory/collector.ts`: it runs `ps -eo pid,ppid,pcpu,rss` every 2 s. On macOS `pcpu` is a decaying average, not a rate over the interval, and it is a share of one core. A failed sweep answers an empty snapshot.

## 3 What holds now

- **The section.** `ProcessesSection` (`app/.../executions/processes/Section.svelte.ts`) keeps the filter, search, folds and output face in the project's scope. `Page.svelte` draws it at `/[project]/processes`, and `lines.ts` groups by owner and by place for the operator.
- **The badge.** `ActivityBadge.svelte` joins a thread's tool calls to its lines. It opens a popover with Active, Unknown and Recent views, and a link to Processes.
- **The share control.** `PaceControl.svelte` is a status-bar dropdown over the `power` module's `Pace`. The operator alone may change it: an agent's `write_setting power.agentWork` refuses `operator-only`. Its mechanics are [[a3213b7f]], [[e38d15f4]] and [[84ff3fc1]].
- **The reading.** `ProcessUsage` keeps per-execution readings under a usage policy. `rateOf` derives cores from two readings. `commandUsage.ts#measuredRows` attaches the latest reading to each command the feed answers.
- **Output.** A command's output face is `commands/Output.svelte`, followed by execution key ([[751118a9]]).

## 4 Target model

The processes are measured by the child decision [[b5f88bb9]]. This decision draws them.

- **One live load feed.** The app subscribes once per project to a load stream. It opens with a snapshot of the machine, the installation, every live execution and every orphan, and then carries only the rows that changed. The footer holds the subscription while the app is open. The popover shortens the step while it is open, by declaring its interest to the same subscription.
- **The button** (`app/chrome`). It is drawn from the feed's machine and installation rows: processor busy as a share of all cores, the footprint of Tagma plus agent work, and the live count.
  - **Warning tone.** The machine is busy at or above 90 % over the last 10 s, the machine's memory is under pressure (the platform's own pressure level, not a byte threshold), or an orphan exists. The figures are this decision's first cut. They are defined relative to the machine, never as a fixed core count or byte count.
- **The popover** (`app/chrome`, one component over the feed).
  - **Header.** The title, the machine's cores and memory, and the share control: `Pace` moved here and drawn as a segmented control, with its applied / not-applied / partial state and its words.
  - **Machine band.** Agents, Tagma, other programs and free. Other is the machine's busy share less Tagma and agents, never below zero.
  - **Machine memory.** A second band under the processor band: the memory agents and Tagma hold, the rest used, and what the platform reports available, with the memory pressure level named beside it (normal, warning, critical) and its source in the hint.
  - **Tree.** Project → place → owner → live execution. Place comes from the execution record's root and the worktree listing ([[04ba7c8d]] carries over). An owner is a thread, the operator, or Tagma's work for the project.
  - **Row labels.** A command's label is its agent-given description, with the program word from `commandWord` beside it. The full command line goes into the row's hint.
  - **Columns.** Trend, CPU (cores, one decimal), memory (footprint) and time (elapsed, with a ring for the used share of the limit).
    - A figure the feed marks partial is prefixed "≈", and its hint names the gaps.
    - An unmeasured figure is "—", and its hint names the reason.
  - **Ordering.** Rows sort by CPU, descending; memory and name are the other orders.
  - **Sandbox work.** A guest's commands never become host executions: `sandbox/guests/environment.ts` runs them through the guest world. So each live sandbox guest bound to a thread stands as one row under that thread, with a guest chip and figures reading "not measured: runs in the sandbox guest" until the guest reports them, never blank and never zero. The rows come from a port the `executions` contract declares and the `sandbox` module fills (rule e090f46d), which answers changes rather than being polled.
  - **The Tagma block.** It lists the installation's processes by role, the desktop shell's own processes (main and renderer) included when the app runs in it. The app running in an ordinary browser tab is the browser's process and reads "in your browser: not measured". A process started by an act that recorded its thread reads "for <thread title>".
  - **Actions on hover and focus.** Open the thread; open the output, which opens `commands/Output.svelte` in a sheet over the current page; stop; more time. Stop and more time work as [[cacb4a15]] describes today.
  - **Orphans.** An orphan is listed at the foot with End. Orphans are: a command no one holds (unheld), a quarantined terminal, and a process that survived an ended execution's sweep (a residual the host's ending itself reported; the sweep of the execution's group is unchanged), shown with its pid, program word and the execution it came from.
  - **The reading's own states.** Unavailable, host not answering, stale and partial are drawn as one banner ([[4b3f4d26]]).
- **The thread badge** (`features/threads`). It stands only while the thread owns a live execution that has run at least 2 s, judged from the execution's start against the app's wall clock, and it stays 1 s after the last such execution ends, so back-to-back short commands do not blink it. It shows `>_ n · c`, with n and c counting only the executions past the 2 s threshold. The two figures are human perception thresholds (flicker, continuity), named once in the app's load feature, never machine figures. The Load button's live count follows the same rule; the popover still lists everything live. It takes the warning tone when the agent exceeds its share once that decision exists; until then it never does. A click opens the popover with the owner's row scrolled to and highlighted.
- **What is removed.**
  - The section: `processes/Page.svelte`, `Section.svelte.ts`, the `processes` surface in `SURFACES`, `processesHref`, and the route `routes/[project]/processes`.
  - The filters, tabs and ended window in the popover path.
  - `ActivityBadge`'s popover and its call rows. A call's arguments and status stay where the transcript shows them.
  - `PaceControl.svelte` as a separate control, and the standing chip's link to Processes.

## 4a Parity with Orca: equal or better on every row

Every capability of Orca's Resource Manager (`.external/orca` c8937936e: `src/main/memory/*`, `components/status-bar/resource-usage-*`, `workspace-space/*`, `workspace-cleanup/*`) has a row here. Each row is shown in the live check (§7). A row is never closed "as Orca does" where this text says better.

| # | Orca | Tagma | Verdict |
|---|---|---|---|
| 1 | Status-bar trigger: resident sum · terminal count, orphans in brackets; icon-only mode. | Busy share of all cores · footprint · live count, orphan dot, warning tone. It goes icon-only when the bar is narrow, and a hover summary gives the same lines. | better: processor shown, and memory is real memory |
| 2 | Hover tooltip lines on the trigger. | The same summary: busy share, memory and pressure, live work by owner kind, orphans. | equal |
| 3 | Header: Restart daemon, Kill all sessions. | Header: Replace host (the existing host-replace act, with its live-work warning), and Stop all agent work (every live execution an agent owns; the operator's own terminals untouched). | better: the operator's shells survive |
| 4 | Daemon-unreachable banner with Restart. | A banner naming the reading state (unavailable, stale, partial, or host not answering) with Replace host; figures dimmed with their age. | better: states named, age shown |
| 5 | Summary: total CPU (% of one core), resident sum, Windows commit with a pressure tone, orphan count. | Machine processor band and machine memory band (§4), with pressure level, commit/private where the platform has it, and the orphan count. | better: machine shares plus pressure level |
| 6 | Sort by name, CPU, memory. | Sort by CPU, memory, name. | equal |
| 7 | Tree: repo → worktree → session, with browser rows. | Project → place → owner (agent with model, operator, Tagma work) → execution. | better: owner level, and agents named |
| 8 | Worktree row: memory sparkline, navigate/resume, delete workspace, remote chip. | Place row: 60 s processor trend (memory trend on the memory sort), open the place, remove the place through the existing worktree removal (refused on main), guest chip for sandbox work. | equal or better |
| 9 | Session row: bound dot, label, CPU/memory, kill (on hover; always shown on orphans), navigate to tab, confirm dialog before kill. | Execution row: phase dot, described label with the program word, CPU/memory/time with limit ring; open thread, terminal or output; stop and more time. No confirm: rule 0f144655 forbids a control that only asks permission. Stop answers in place, and a stopped row shows its ending until the next step. | better, except the confirm, which is excluded by rule |
| 10 | App section: Electron main / renderer / other. | The Tagma block: server, database workers, execution host, git and inspections with the thread they serve, and the desktop shell's main and renderer. | better: attributed |
| 11 | Footer: Kill N orphans; Clean up workspaces. | Foot: End all orphans, one act, with each orphan listed with its origin; Clean up places opens the existing worktree cleanup. | better: origin shown |
| 12 | Space: scan disk usage per worktree, reclaimable bytes, top-level items, progress, cancel, cached result shown stale while it refreshes. | Space: the same scan per place, with size, reclaimable (ignored build output and dependencies git would not keep), the top 10 items, progress, cancel, and the cached result with its age. It is run on demand and never on a clock. | equal |
| 13 | Host memory: total, free, available (memory_pressure / MemAvailable), used share, cores, 1-minute load average. | The machine reading: total, used, available, pressure level with its source, logical cores and busy share (not the load average, which is a queue length, not a share). | better: pressure level |
| 14 | Windows: CIM with a typeperf fallback; working set; commit. | Windows and Linux: the native library carries the readers (process times, private bytes, `GlobalMemoryStatusEx`; `/proc`, Pss, `MemAvailable`), but no toolchain for either ran them and the host announces `load` on darwin alone, so those hosts show no load until a qualified run wires them. | worse until then (built and unrun; not announced) |
| 15 | Coalesced sweeps: `ps` every 2 s while open; the session list read on open. | A host push stream, one profile period (`usage.periodMs`) while open and five periods otherwise, and no work with no subscriber. No process spawned per step. | better |
| 16 | States: Loading…, Nothing running. | Loading, nothing live (with the last-live time), and the reading states of row 4. | equal |
| 17 | Keyboard: rows activate on Enter/Space; the kill button is focusable. | Rows are a listbox: arrows move, Enter opens, and the row's actions are reachable by Tab; Escape closes. | better |
| 18 | Setting: show or hide the segment in the status bar. | The same, as an appearance setting declared by the chrome's manifest. | equal |
| 19 | Orphans: sessions no tab binds. | Unheld commands, quarantined terminals, and residual processes an ended command left running. | better: residuals caught |
| 20 | Remote (SSH) sessions marked remote. | Sandbox-guest executions marked "runs in the sandbox guest" and not left blank. | equal |

## 5 Owners and boundaries

- **The Tagma surface** ([[cc59eadf]]).
  - `app/chrome`: the button, the popover, and the share control moved into it.
  - `features/executions`: the load feed's client repository, the row model and the output sheet.
  - `features/threads`: the badge.
- **The server's `executions` module** (the live load feed). It composes the host's readings with thread titles, places and project ownership. The admission and stop roads stay where they are.
- **The measurement** is owned by the child decision, in `@runlith/executions` and `@runlith/execution-host`.
- **`power`** keeps the share. Only its control moves.

## 6 Rejected

- **Keep Processes and add the button.** That is two surfaces answering one question, and the section is the dump this decision removes.
- **Copy Orca's sweep** (`ps pcpu` every 2 s). It spawns a process per sweep, its figure is a decaying average and not a rate, and it is a share of one core.
- **Poll from the browser.** It asks the host again whenever nothing changed. The feed pushes changed rows only (rule [[2393aff1]]).
- **List ended commands in the popover.** They are the transcript's. The popover answers "what loads the machine now".

## 7 Acceptance

- A thread running `bun test --parallel` over every core is reached in two clicks from anywhere: the button, then its row, which shows its cores and stands first. Stop on that row ends it.
- With 20 live commands and 3 terminals, no row shows "—" or "≈" without a hint naming why, and every live terminal row carries CPU and memory.
- The machine band's four parts sum to 100 %. Over one 10-second window, agents plus Tagma agree with `top`'s sum over the same processes within one step's error.
- The popover lists no ended execution. An execution that ends leaves the popover within one step.
- A thread with no live execution shows no badge.
- Under memory pressure the button takes the warning tone and the memory band names the pressure level, with no processor load involved.
- A command that starts `sleep 600 &` and exits leaves no orphan: the ending's sweep ends it, as it does today. A child that escaped the sweep (started with `setsid`) and that the ending reports as residual stands as one orphan at the foot naming that process and its origin, and End ends it.
- In the desktop shell, the Tagma block lists the shell's main and renderer processes with figures.
- A thread with a live sandbox guest shows one guest row under it, reading "not measured: runs in the sandbox guest"; the row leaves when the guest is released.
- Sorting by memory puts the largest footprint first.
- The share control in the popover changes `power.agentWork` exactly as the status-bar dropdown did, and says when a level was not applied.
- `/[project]/processes` no longer exists. No link to it remains in the app.
- **Parity proof.** The live check walks §4a row by row, on the running build, and records for each row what was done and what was seen (a screenshot or a measured figure), beside Orca's behaviour for the same row. The decision closes only when every row reads equal or better, except row 9's confirm, which is excluded by rule.
- **Accuracy proof.**
  - Processor: over a controlled load of `yes > /dev/null` pinned to 1 and to 4 processes, the execution row reads 1.0 ± 0.1 and 4.0 ± 0.2 cores within two steps. Orca's `pcpu` over the same run is recorded beside it.
  - Memory: on darwin, a process allocating and touching 500 MiB reads 500 MiB ± 5 % footprint, while its resident figure is shown in the hint.
  - Idle cost: with the popover closed and nothing live, the host and server spend under 0.5 % of one core together, over one minute.

## 8 What becomes of what stands

- [[ba15d2f5]] (closed): superseded by this decision when it is built.
- Die with the section: [[d970ca18]], [[8a1eb50c]], [[59195588]], [[b0093c88]], [[d1a767ca]], [[1641f184]], [[8481b913]], [[96145dd3]], [[43415be2]], [[2f5d2a33]], [[ca5e9b19]] and [[8b332ef6]].
- Rewritten for the popover:
  - [[04ba7c8d]] (place grouping);
  - [[7283eea7]] (Processes leaves `SURFACES`);
  - [[cacb4a15]] (stop and more time on a popover row).
- Survive as they stand: [[751118a9]] (output reader, now in a sheet) and [[4b3f4d26]] (the reading's silences).
- [[6cb16dfe]] (the ended window): read again when the section is removed. It dies with its last consumer, or it stays for the one that remains.
- [[da80d060]] (task): closed by the removal of the section's dead act.
- Unchanged: [[a3213b7f]], [[e38d15f4]] and [[84ff3fc1]]. The share's mechanics stay; only its control moves.
- Claims over `ActivityBadge.svelte` and `PaceControl.svelte`: read at build, then rewritten or retired with their code.

## 9 Order

1. The measurement ([[b5f88bb9]]).
2. The live load feed.
3. The button and the popover, with the share control moved in.
4. The badge.
5. Removal of the section, the old popover and the separate control, with their claims.

## 10 Contract

The load feed is a new live group on the server's socket door, declared in the `executions` contract and projected by `invocation` like every other live group. App and server ship in one bundle. The host's reading gains fields the server reads as optional, so a server over a host from the previous build shows the old figures labelled as such (see [[b5f88bb9]]).

## 11 Stored data

out: the app keeps the 60-second trends in memory, per subscription. Nothing new is stored by the server.

## 12 Who may do what

- **Stop, more time and ending an orphan** go through today's operations and their permissions.
- **The share** stays operator-only: the server refuses an agent's write, and the control is drawn for the operator alone.

## 13 Long-lived things

- **The subscription** lives while the app is open. The popover's shorter step lasts while the popover stands, and is withdrawn on close.
- **The feed's composition on the server** is shared by every view of one project. The last view to leave ends it, as the command feed's does ([[e17f5812]]).

## 14 Bounded resources

- **Rows** are bounded by live executions, the installation's processes and orphans.
- **Trends** are 60 points per owner and place row, held in the app.
- **The feed** carries changed rows only, per step.
- The measurement's own ceiling is the child decision's.

## 15 Rollout

A reload lands the app. A host from the previous build keeps working, with resident memory labelled as resident and rates as today, until it is replaced.

## 16 Failures

- **The host is not answering.** The button reads "?" with the reason in its hint. The popover shows the banner, and the last figures are dimmed with their age.
- **The server restarts.** The subscription reopens and takes a fresh snapshot.
- **An execution ends between two steps.** Its row leaves at the next frame. A stop on a row already gone answers the stop road's refusal in place.

## 17 Observability

- **Server.** A `load.feed` span per frame carries the rows changed and the frame's size.
- **App.** User Timing `tagma.load-open` measures from the click to the first drawn frame of the popover.
