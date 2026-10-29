---
id: 01a11b5e-918b-7fdb-80da-5009552ae607
title: "Load — Tagma's compact task manager: Tagma's and its agents' CPU and memory, what occupies them, the whole machine as a footnote, and one button to stop it"
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The Load panel is Tagma's compact task manager: how much CPU and memory Tagma, its agents and everything they launched eat, what exactly occupies it, and one button to stop it. Whole-machine load is a footnote beside it: the reader sees the agent eating 30% while the machine runs at 90%, and the other programs wait in one collapsed row for when it's needed to tell who else loads it. Every percent of the machine is attributed to something in the list — "uncounted" never appears in the panel.

## Why the rework

Measurement of 2026-10-13 on the operator's machine (12 cores, machine CPU 85–100%): the release-publish agent's typecheck showed 1–4%, while its child `svelte-check`s took 1–2.7 cores each; "Not apportioned" — 50–61%. Causes:

- a process counter is only its own time (`ri_user_time + ri_system_time`, on Linux `utime + stime`): a process born and dead between measurements is never seen at all, while typecheck and tests are dozens of short processes;
- sampling is bounded and rotates (522 of 749 rates), a rate needs two consecutive measurements;
- the OS doesn't hand over root processes' counters (WindowServer, mds, kernel_task) — 230 refusals — although setuid `/bin/ps` reads them;
- the interface lays out by projects, places and roles, in two modes, with measurement categories (Managed work / Tagma ≥ / Unattributed ≥), "undecomposed" shares and partial-read details — and nowhere answers "what loads".

## The panel

**The low bar is Resource Manager Orca** (`.external/orca`, `src/renderer/src/components/resource-usage-*.tsx`, commit `0df25b7ac9`): a compact popover about 420 px, one totals row "CPU · memory", a tiny Name / CPU / Memory column header to sort by, dense "chevron · name · sparkline · CPU · memory · ✕" rows with fixed-width columns and ✕ in a shared tail gutter appearing on hover. Our panel matches it in density and cleanliness and beats it in substance: Orca sees only its own terminals and the app itself, doesn't see the machine, doesn't attribute the agent's descendants to the agent, doesn't expand processes and doesn't say how a kill ended.

**Header.** Tagma CPU and memory large: the server, the window, the execution host and everything agents and terminals launched. Under each figure a bar — Tagma's share, the rest of the machine grey, free empty — and a "Mac in total" footnote: machine CPU from core count and occupied memory ("22.1 of 32 GiB", pressure when present). Below, a small chart of the last minutes: Tagma's heaviest rows in their colors, the rest of Tagma as one layer, machine CPU as a grey shadow behind them; the scale is taken from Tagma's peak, and shadow above the scale is clipped, otherwise 2% Tagma on a 90%-busy machine is a flat line; hovering a row highlights its layer. The rest of the machine's memory is its occupied memory above Tagma's: process footprints overlap, and their sum exceeds the machine's occupied memory. Each row has its own sparkline — what it ate over the last minutes.

**The list.** One unit everywhere — percent of the whole machine: Tagma rows sum into its figure, all rows into machine CPU. Tagma itself on top, then the "Agents" group, then "Terminals and commands" — executions with no thread; groups have their own totals. The rest of the machine is one collapsed "Rest of the Mac" row with programs and System inside. A top-level row is what the reader recognizes and can kill whole:

- **agent** — the thread name, the project; second row — what it currently launches (the command title, "Typecheck tagma and github kit"). CPU and memory — the whole tree of all its commands and terminals, with grandchildren and short processes, including processes its command left behind. The "Stop" button kills all the agent's work; the thread continues the turn and receives the command outcome. The name opens the thread;
- **Tagma** — the server together with its own agents' model loop, its execution host and the window; no button;
- **thread-less execution** — a Tagma command or terminal owned by no agent; stops as work;
- **program** — a whole app: Google Chrome with all helpers, Docker, Activity Monitor, WindowServer, the operator terminal; stands in "Rest of the Mac". The "Terminate" button kills its processes.

A row expands into its processes — program name, PID, CPU, memory — and each process has its own "Kill" button. The button exists everywhere the OS lets the user signal; root processes and Tagma's own server, its execution host and window have none.

Killing follows verified identity: pid and birth are re-read before the signal, SIGTERM first, SIGKILL after a couple of seconds to what remains. The row shows the outcome: gone, remaining, identity changed, refusal. A sent signal doesn't count as success.

**Sorting and filter.** Sort by CPU (default), memory or name — by pressing the column header. Sorting applies within each group. Above the list a search field by name, command and PID; it also searches the rest of the machine. CPU order is taken as the average over the last ~5 s so rows don't jump every tick. Rest-of-machine rows under 0.5% collapse inside "Rest of the Mac" into one "Others — N" that expands; Tagma rows never collapse.

**Agents' share.** The header holds a Full · Low · Lowest switch — the machine share for agent commands (the `power.agentWork` setting, the same as in Power settings): it changes here in one press, watching the load. The hint says how many running processes the level applied to and what failed.

**Removed from the panel:** the Processes / Work by agent tabs, grouping by projects and places, the split into "managed work", "Tagma" and "Unattributed", "Not apportioned", "Partial reading — measurement details", "N / M CPU rates", "Clean up places", "Stop agent work · N", "End N without owner", places' disk space, the Time column.

**The status bar** shows Tagma CPU and memory and its heaviest row when it takes at least 10% of the machine: "CPU 34% · 4.6 GiB · release-publish 31%". The whole machine is in the hint; machine CPU saturation and memory pressure still light the warning color.

## Measurement

Goal: row sums equal machine CPU within interval noise. An unread process is an adapter defect, fixed in the adapter, not an interface category; while such a defect stands, a row with an unread member shows the measured value with a mark and cause in the hint and never passes unread off as zero.

- **A process counter includes its reaped children's time.** macOS — `ri_child_user_time + ri_child_system_time` of the same `proc_pid_rusage`; Linux — `cutime + cstime` from `/proc/<pid>/stat`; Windows — the execution's job-object accounting, because reaped children's time doesn't exist there. The native ABI hands over both numbers, each platform fills the contract itself.
- **A row's CPU** per interval is the growth of the "own + reaped children" sum over its tree's live members. A descendant's exit and reap inside the tree carries its time into the parent counter, so the sum stays continuous and a process living less than an interval is counted. A row counter is monotone: a dip from a zombie or a missed member is never subtracted and never counted twice later. The execution root's final time, reaped by the holder, is taken from its rusage at reap.
- **The whole population is measured on every pass** — no rotation and no sample cap; pass cost grows with the machine's process count, and it is fit into budget by speeding the pass up, not by skipping processes.
- **macOS:** counters the OS won't hand over (root processes, `kernel_task`) the adapter reads in one setuid `/bin/ps` call per pass.
- **A program is an app.** macOS: the outer `.app` in the executable path (`Google Chrome Helper (Renderer).app` inside `Google Chrome.app` → Google Chrome); a bundle-less process belongs to the nearest bundled ancestor's app, and with no such ancestor to its own executable (`WindowServer`, `mds`). Linux and Windows group by their own rules in their own adapters; the kernel knows no grouping.
- **Agent work** is each of its executions' tree, with descendants detached from the tree, by already-proven provenance; PID reuse carries no provenance.
- **Process facts** (path, command, cwd) are read once per pid + birth identity. Currently `Usage.named` re-reads them on every CPU-counter change, i.e. on every pass for every busy process.

## Construction

- `packages/executions` (`protocol/evidence`) — the one-read contract: rows (agent work by execution, or a program) with CPU in machine shares, memory and processes; history for the chart.
- `packages/execution-host` — measurement, counters with children, attributing each process to exactly one row, grouping by app (platform adapter), killing a process and a row by verified identity.
- Server-side `executions/load` — binding executions to thread, project and command title, merging one thread's executions into one agent row, the ready list with totals — Tagma whole, agents, thread-less executions, the rest of the machine and its collapsed rows — and Tagma's share at each history point; `read_machine_load` answers the agent with the same list.
- The app only paints the ready list, sorts and filters it, and invokes acts. Adding, laying out and subtracting in the UI (`tree.ts`, `sums.ts`, `LoadBands`, `LoadProcesses`, `LoadOrphans`, the panel's project reads) leave with the old shape in the same change.

One sampler pass per live-subscription step, no subprocess per process; the only subprocess is one `ps` per pass on macOS. The subscription lives while the panel is open or an operation read runs.

## Proof

The implementer proves:

- a native test: a parent spawns and reaps a child burning noticeable CPU between two reads — the parent counter contains that time (macOS and Linux);
- a counting test: an execution's short descendants are attributed to that execution, a child exiting between reads isn't counted twice, a row counter is monotone on a missed member;
- a kill test: a changed identity gets no signal, a refusal and a remaining process don't count as success;
- a scenario on its own instance (`tagma:try`, not the working server): an agent command launches a stream of short loading processes (each < 1 s) — the agent row shows CPU within ±20% of the `ps` sum, settled-mode row sums differ from machine CPU by no more than 5% of the machine; panel snapshots under such load;
- typecheck and tests of changed owners; sampler pass cost before and after.

The operator checks it himself: at 100% CPU he opens the panel, immediately sees what loads, and kills it with one button.
