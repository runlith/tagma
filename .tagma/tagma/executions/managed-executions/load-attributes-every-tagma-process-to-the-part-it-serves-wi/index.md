---
id: 01a19236-e2ce-7b34-8015-7c0e70df78a3
title: Load attributes every Tagma process to the part it serves — window, each page, server, host, each agent — and OS specifics live only in usage adapters
ord: 102
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a11b5e-918b-7fdb-80da-5009552ae607
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c14dac7eb7
  - kind: relates
    to: 01a18ca9-b53e-77a7-8f24-62e99bfaa095
  - kind: relates
    to: 01a19222-30cc-7f51-a61f-79130ab5aec3
sources:
  - kind: file
    ref: apps/tagma/desktop/src/server.ts
  - kind: file
    ref: apps/tagma/server/src/executions/load/list.ts
  - kind: file
    ref: packages/execution-host/src/posix/macos/programs.ts
  - kind: file
    ref: packages/execution-host/src/posix/macos/Sampler.ts
  - kind: file
    ref: packages/execution-host/src/ProcessAccount.ts
  - kind: file
    ref: packages/execution-host/src/ProcessUsage.ts
  - kind: file
    ref: packages/execution-host/src/UsageReader.ts
---
## Outcome

Opening Load answers "what of Tagma is eating my machine, and can I stop it" down to a part a person recognizes: the window's interface, its graphics process, each built-in browser page and each app or MCP view by name, the server, the terminal host, each agent with its commands, terminals and what they left. Other programs stay a secondary, collapsed section that costs no per-process reading of refused processes while closed. The same core runs on macOS, Linux and Windows: a new OS adds adapters and changes no core, contract, server or app code.

## Why

One reading, 2026-10-31, 12-core Mac: the machine at 57–62%, the panel's Tagma figure 3.4%. Eleven built-in browser pages, loaded but shown nowhere, took about 37% of the machine through the window's renderers and GPU process. All of it stood as the outside program "Tagma Dev" under the collapsed "Rest of the Mac", while the Tagma list showed 13 agents at 0.0–0.3%. Closing the pages dropped the machine to 17%. Causes in the code:

- The window counts as Tagma only while the server is its direct child (`ProcessUsage.ts`: `rows.get(serverPid)?.parent === desktopPid`), and the window pid reaches the host from `TAGMA_DESKTOP_PID`, fixed in the server's environment by the window that spawned it. The server is spawned detached, outlives windows and hands over to successors: in the reading its parent was launchd and its variable named pid 9106, while the window was 32437. The `Load` request takes both pids once, at open (`protocol/wire.ts`); only `interested` changes afterwards.
- Placement follows parent links only (`ProcessAccount.place`), so OS services working for Tagma stay outside — macOS `VTDecoderXPCService` and `MTLCompilerService` had Tagma's GPU process as their responsible process — although the native reader already returns that link (`usage.rs`) and uses it only to name programs.
- The window has no parts: its renderers read "Electron Helper (Renderer)", so no page or view can be blamed.
- The list spends its height on idle agents and sorts within groups, so the heaviest Tagma consumer cannot reach the top.
- Every pass, the sampling worker runs one batched synchronous `/bin/ps` for all processes the OS refuses (`posix/Sampler.ts`) — 156 root processes, about 60 ms of which 50 ms system in one measurement — whether or not anyone opened other programs.
- OS specifics stand in shared code: `.app` bundle grouping and the `ps` fallback in `posix/`, which a Linux adapter would share; "Mac" in the app's words. The host boots only on macOS (`composition/platform.ts`).

## What is Tagma's

A process is Tagma's when any of these holds; every other process is outside.

1. It is a declared part of Tagma: the server, the execution host and its holder, and each process of a connected Tagma window. Each part is declared by whoever knows it; nothing is inferred from parentage between parts.
2. It descends from a Tagma process by the kernel's parent links, at any depth — including what agents' commands and terminals started and what they left behind, as executions and residuals do now.
3. The OS records it as working on behalf of a Tagma process (macOS: the responsible process). An adapter without such a record contributes nothing here.

Each Tagma process lands in exactly one row. Executions claim first, as now; then each declared part claims itself, and descent from a part stops at another part — the server a window spawned, and its children, stay the server's.

A declared process is Tagma's only once the host resolves it to the kernel's own witness (rule [[62049465]]). A window declares a pid with Electron's creation time (epoch milliseconds), while a witness's birth is the adapter's opaque OS form ([[7f126a5b]]): resolving a pid and an epoch creation time to the witness, within the declared precision, is a process-reader adapter operation answering the witness, a different process, or unknown. An unknown or different answer leaves the process outside and says so in the reading.

Out of reach, and said in the panel's hint rather than hidden: compositing the OS does for the window (macOS WindowServer) cannot be split per process and stays outside; a Tagma web client opened in a person's browser is that browser's process.

## The window declares itself

Desktop main declares its processes: pid, Electron creation time and part — main, graphics, utility, or renderer. For a renderer it lists the documents it hosts, read from Electron on every OS: each webContents (`getOSProcessId`) is the interface, an app-view window, or a built-in page by page id; each frame inside them (`mainFrame.framesInSubtree`, `frame.osProcessId`, as the page strain code already walks) belongs to its webContents' document — a frame of a built-in page on another renderer is still that page — except a view's frame: the client names each view iframe it mounts with the view's identity (an app view by app id and view, an MCP App view by its server), which desktop main reads as `frame.name`. Every MCP App view shares one sandbox origin, so the origin cannot tell their servers apart. The server turns page ids, app ids and servers into titles; desktop main sends no names it does not own.

The declaration rides desktop main's existing local channel to the server — the one the browser host attaches with a host id and generation, which a paired device never gets, since pids mean nothing off the server's machine. Desktop main sends a whole replacement whenever the set changes (a renderer starts or ends, a frame or page moves to another renderer, a window opens or closes); a new generation replaces the old one and the declaration ends with its generation. Several windows each declare under their own host id; the server holds the union.

`executions/load` declares in its contract a port taking the current declarations; the desktop channel's owner fills it and composition binds them (rule [[e090f46d]]); execution-host never sees browser or app types. The host's load subscription takes the declared parts as a neutral list (pid, epoch creation time with its precision, an opaque part key) and accepts replacements within a live subscription; `desktopPid`, `TAGMA_DESKTOP_PID` and the parent check leave.

## Rows

Under Tagma's figure, one list of Tagma's rows, sorted as one list by CPU, memory or name. CPU cannot be split inside one process, so a window row is one process, titled by what it hosts:

- **Interface** — desktop main and the interface's renderer with the documents it hosts; utility processes.
- **Graphics** — the GPU process with the OS services working on its behalf.
- **A renderer of pages or views** — titled by its documents: "Page — title (host)", "App — name", "MCP view — server"; a renderer hosting several lists them all and counts once. Its action closes the built-in pages it hosts; a view is closed where the operator placed it, so a renderer hosting only views, or also the interface, has no action.
- **Server** — as now, with its reaped part and background work.
- **Terminal host** — the execution host and its holder.
- **Agent** and **thread-less work** — as now, with their stop.

Sorted by CPU and not searching, rows whose CPU over the ranking window stays below 0.1% of the machine fold into one "Idle — N" row at the end of Tagma's list; sorting by memory or name, or searching, shows them in place. Search covers names, page titles and hosts, app and server names, commands and pids.

Other programs form one collapsed section below Tagma: programs grouped by the adapter's rule, and one remainder row — the kernel plus whatever the OS did not let the adapter read. A reader states its demand for other programs separately from `interested`: while the section is open or a search runs, the adapter reads refused processes, batched once per pass; otherwise it does not, and their CPU stands in the remainder row.

No interface or contract text names an OS: the machine's name ("Mac", "PC") comes from the adapter's machine facts.

**Header.** The list is the panel; the header above it stays a few lines: the title with the agents' share switch; a problem callout, dismissible, which returns only when the problem changes; one line per figure — Tagma's CPU and memory large, the machine's figure dimmed beside it, cores and totals in the hint — over its bar; the chart with its span and scale inside its corners. The legend, the chart's axis row and standing status lines leave: the bars' hint names their colours, a part of the reading that was not read goes into the hint of the figure it affects, and GPU not measured on this system goes into the hint of the CPU figure. A stop's outcome stays as a line until dismissed.

**GPU.** The host reading carries each process's GPU as measured or unavailable with the adapter's reason; rows sum the measured part. The panel shows a GPU column only while the reading measures GPU for some process, and a row with an unmeasured member marks it as it marks unread CPU; with nothing measured, the panel says once that GPU is not measured on this system and why — never zero, and the Graphics row's CPU never stands for GPU. On macOS a per-process source is measured: IOKit `AGXDeviceUserClient` `AppUsage` GPU time keyed by the creator pid, which carries Tagma's GPU process and needs no privilege ([[8f301071]]); its adapter reads the registry natively, since two `ioreg` runs cost about 58 ms of CPU per pass. Linux (DRM fdinfo) and Windows (GPU Engine counters) sources are documented, not measured. The GPU step is done when, for each OS, either a named per-process source is proven by a measurement on that OS and its adapter fills it, or a finding records that none exists without privileges and the panel says so there.

## OS adapters

The core is OS-neutral: the `@runlith/executions` load protocol; the execution host's placement, accounting and grouping (`ProcessUsage`, `ProcessAccount`, `processTree`, `processSpending`); the server's `executions/load`; the app. It reads only the adapter ports and never branches on platform (rule [[6f758080]]).

The usage port (`UsageReader`) answers, per process: identity witness, parent, the CPU counter and whether it includes reaped descendants, memory — the OS's non-shared figure where one exists (macOS `phys_footprint`, Linux PSS, Windows private bytes), else resident — name, command, program (key and name by the adapter's grouping rule), the on-behalf-of pid where the OS records one, and GPU where measured; per execution, a cumulative CPU counter of the OS container holding its whole tree where the OS keeps one (Windows job object); the machine counters and the machine's name. It takes the reader's demand for refused processes. An optional measure the adapter cannot take carries a reason, never zero.

Accounting keeps sums whatever the adapter has: with counters that include reaped descendants, an ended execution's last fragment moves out of its reaper's growth, as now; with an execution container counter, the execution's CPU is that counter's growth, including members born and gone between passes; with neither, short members are not seen and the reading says the execution's figure is a lower bound.

- **macOS** — native `proc_pid_rusage` counters with reaped children, `phys_footprint`, the responsible process as on-behalf-of, `.app` grouping, setuid `/bin/ps` for refused processes on demand, birth resolution of `seconds:micros`: all in the macOS adapter, out of `posix/`.
- **Linux** — the native `/proc` reader exists (`usage.rs`: utime and stime with cutime and cstime, PSS); grouping by executable; no on-behalf-of; `/proc` gives other users' counters, so no refused set; birth resolution of start ticks against boot time.
- **Windows** — the native reader exists without reaped children; the execution's job object gives the container counter; grouping by executable; birth resolution of FILETIME.

These readers belong to whole host adapters, and Linux and Windows have none yet (`composition/platform.ts` refuses to boot): terminals and commands wait on them, not only Load. This spec makes Load ask nothing of those adapters beyond these ports.

## Work, in order

1. Port and macOS adapter boundary: `.app` grouping, the responsible link, the `ps` fallback and birth resolution sit in the macOS adapter; the fallback runs on demand; the core loses every OS name.
2. Window declaration: desktop main declares documents and processes, the channel carries generations, `executions/load` takes them through its port, the host resolves and places them in a live subscription; the environment variable and the parent check go.
3. On-behalf-of placement and the execution container counter in core accounting.
4. Server rows and the app list: renderer rows titled by their documents with close, one sorted Tagma list, idle folding, demand for other programs, OS-neutral words.
5. GPU source per OS, ending as the GPU paragraph says.

## Contracts between the parts

Each contract has one owner, who lands it first; the others code against it.

- **Host protocol** (`@runlith/executions`, owner: the host task). `DeclaredPart` — `{ key, pid, createdMs, precisionMs }`: `key` is opaque, chosen by the server; `createdMs` epoch milliseconds. `GroupOwner` gains `{ _tag: 'Part', key }` for what a declared part claims. The `Load` request takes `serverPid` and `parts` instead of `desktopPid`; a live subscription accepts a whole replacement of `parts` and an interest of `{ interested, others }`, `others` being the demand for refused processes. A reading carries the declared parts it could not resolve with their reason, the machine's name, and marks an execution group whose figure is a lower bound. `LoadSubscription` exposes `setParts` and the widened interest; `ExecutionEvidence.load(serverPid, parts)`.
- **Window declarations** (`executions/load` contract, owner: the rows task; filled by the window task). A port taking `declare(host, generation, processes)` and `end(host, generation)`, where a process is `{ pid, createdMs, kind: main | graphics | utility | renderer, documents }` and a document is `Interface`, `Page { page }` (browser page id), a view by the identity its iframe's name carries, or `Origin { origin }` (any other webContents or frame). The server keys each process as a part, resolves names (page title and host, app title, MCP server) and passes parts to the host subscription.
- **Precision** of Electron's creation time against the kernel's start is measured by the window task on macOS and sent as `precisionMs`; the adapter resolves a pid only when exactly one kernel process of that pid started within it.

## Proof

- Placement through the host's load reading: with a server whose parent is not the window, the declared window's processes land in window rows; a declared pid whose creation time does not resolve stays outside; a launchd-parented service on behalf of a Tagma process is Tagma's; an execution's claim beats a window's; a replacement inside a live subscription moves rows and a new generation drops the old one's.
- A usage-port double with no reaped part, no on-behalf-of and no GPU, but an execution container counter: an execution that starts and ends between two readings is charged in full and row sums stay continuous. Without the container counter the same reading marks the figure as a lower bound.
- With other programs not demanded, no refused-process read runs in a pass; with demand, one batched read runs.
- A desktop e2e in the testbed Electron lane: a built-in page running a busy loop and an app view frame on its own origin each appear in a row titled by their document, with their renderer's CPU; every window row counts inside Tagma's figure; the page row's close closes the page. Where no harness runs desktop, server and host together, the chain — declaration through the desktop channel, the port, the host subscription's parts, the rows — is proven by tests crossing each seam through its real door, and the e2e covers the desktop side.
- No OS name or path (`darwin`, `win32`, `linux`, `.app/`, `/bin/ps`, `/proc`, "Mac") in the core paths named above, adapters and composition excluded, judged by a check scoped to those paths; `vendor-ids` does not cover them. Enforcing that check is the operator's word.
- Sampling-worker cost per pass, with its child processes, with other programs closed and open, before and after.
