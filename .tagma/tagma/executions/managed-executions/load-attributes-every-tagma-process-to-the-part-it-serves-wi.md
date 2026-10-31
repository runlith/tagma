---
id: 01a19236-e2ce-7b34-8015-7c0e70df78a3
title: Load attributes every Tagma process to the part it serves — window, each page, server, host, each agent — and OS specifics live only in usage adapters
ord: 102
tags: ["spec"]
fields:
  {
    "status": "open"
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
    ref: packages/execution-host/src/ProcessUsage.ts
  - kind: file
    ref: packages/execution-host/src/ProcessAccount.ts
  - kind: file
    ref: packages/execution-host/src/UsageReader.ts
  - kind: file
    ref: packages/execution-host/src/posix/Sampler.ts
  - kind: file
    ref: packages/execution-host/src/posix/programs.ts
  - kind: file
    ref: apps/tagma/server/src/executions/load/list.ts
  - kind: file
    ref: apps/tagma/desktop/src/server.ts
---
## Outcome

Opening Load answers "what of Tagma is eating my machine, and can I stop it" down to a part a person recognizes: the window's interface, its graphics process, each built-in browser page and app view by its title, the server, the terminal host, each agent with its commands, terminals and what they left. Other programs stay a secondary, collapsed section that costs nothing while closed. The same core runs on macOS, Linux and Windows: a new OS adds a usage adapter and changes no core, contract, server or app code.

## Why

One reading, 2026-10-31, 12-core Mac: the machine at 57–62%, the panel's Tagma figure 3.4%. Eleven built-in browser pages, loaded but shown nowhere, took about 37% of the machine through the window's renderers and GPU process. All of it stood as the outside program "Tagma Dev" under the collapsed "Rest of the Mac", while the Tagma list showed 13 agents at 0.0–0.3%. Closing the pages dropped the machine to 17%. Causes in the code:

- The window counts as Tagma only while the server is its direct child (`ProcessUsage.ts`: `rows.get(serverPid)?.parent === desktopPid`), and the window pid reaches the host from `TAGMA_DESKTOP_PID`, fixed in the server's environment by the window that spawned it. The server is spawned detached, outlives windows and hands over to successors: in the reading its parent was launchd and its variable named pid 9106, while the window was 32437.
- Placement follows parent links only (`ProcessAccount.place`), so OS services working for Tagma stay outside — macOS `VTDecoderXPCService` and `MTLCompilerService` had Tagma's GPU process as their responsible process — although the native reader already returns that link (`usage.rs`) and uses it only to name programs.
- The window has no parts: its renderers read "Electron Helper (Renderer)", so no page can be blamed.
- The list spends its height on idle agents and sorts within groups, so the heaviest Tagma consumer cannot reach the top.
- Every pass runs a synchronous `/bin/ps` (`posix/Sampler.ts`, `Bun.spawnSync`) for each process the OS refuses — 156 root processes, about 60 ms of which 50 ms system — blocking the host's loop for processes nobody opened.
- OS specifics stand in shared code: `.app` bundle grouping and the `ps` fallback in `posix/`, which a Linux adapter would share; "Mac" in the app's words. The host boots only on macOS (`composition/platform.ts`).

## What is Tagma's

A process is Tagma's when any of these holds; every other process is outside.

1. It is a declared part of Tagma: the server, the execution host and its holder, and each process of a connected Tagma window. Each part declares itself; nothing is inferred from parentage between parts.
2. It descends from a Tagma process by the kernel's parent links, at any depth — including what agents' commands and terminals started and what they left behind, as executions and residuals do now.
3. The OS records it as working on behalf of a Tagma process (macOS: the responsible process). An adapter without such a record contributes nothing here.

Each Tagma process lands in exactly one row. Executions claim first, as now; then each declared part claims itself, and descent from a part stops at another part — the server a window spawned, and its children, stay the server's. A declared process is accepted only when its pid and birth match the kernel's table (rule [[62049465]]); a mismatch is a reused pid, not Tagma's.

Out of reach, and said in the panel's hint rather than hidden: compositing the OS does for the window (macOS WindowServer) cannot be split per process and stays outside; a Tagma web client opened in a person's browser is that browser's process.

## The window declares itself

Desktop main sends the server its process set over a local-only connection — like the browser host, a paired device never declares, since pids mean nothing off the server's machine. For each process: pid, creation time and part — main, graphics, utility, or a renderer with the documents it serves: the interface, an app view by id, a built-in page by page id. Electron supplies all of it on every OS (`app.getAppMetrics`, `webContents.getOSProcessId`), so no OS adapter is involved. Desktop main re-declares when the set changes (a renderer starts or ends, a page moves to another renderer); the declaration ends with the connection. The server hands the current declarations to the host's load subscription in place of `desktopPid`; `TAGMA_DESKTOP_PID` and the parent check leave.

## Rows

Under Tagma's figure, one list of Tagma's rows, sorted as one list by CPU, memory or name:

- **Interface** — desktop main, the window's own renderers and utility processes.
- **Graphics** — the GPU process with the OS services working on its behalf.
- **Page** — a built-in page by title and host, holding its renderer; a renderer serving several pages names them all and counts once. Its action closes the page through the browser's close.
- **App view** — by title, holding its renderer.
- **Server** — as now, with its reaped part and background work.
- **Terminal host** — the execution host and its holder.
- **Agent** and **thread-less work** — as now, with their stop.

Sorted by CPU and not searching, rows whose CPU over the ranking window stays below 0.1% of the machine fold into one "Idle — N" row at the end of Tagma's list; sorting by memory or name, or searching, shows them in place. Search covers names, page titles and hosts, commands and pids.

Other programs form one collapsed section below Tagma: programs grouped by the adapter's rule, and one remainder row — the kernel plus whatever the OS did not let the adapter read. Processes the OS refuses are read one by one only while that section is open or a search runs, and the read never blocks the host loop; otherwise their CPU stands in the remainder row.

No interface or contract text names an OS: the machine's name ("Mac", "PC") comes from the adapter's machine facts.

## OS adapters

The core is OS-neutral: the `@runlith/executions` load protocol; the execution host's placement, accounting and grouping (`ProcessUsage`, `ProcessAccount`, `processTree`, `processSpending`); the server's `executions/load`; the app. It reads only the usage port and never branches on platform (rule [[6f758080]], enforced by the `vendor-ids` inspection).

The usage port (`UsageReader`) answers, per process: identity (pid, birth), parent, the CPU counter with its reaped-children part where the OS keeps one, memory — the OS's non-shared figure where one exists (macOS `phys_footprint`, Linux PSS, Windows private bytes), else resident — name, command, program (key and name by the adapter's grouping rule), and the on-behalf-of pid where the OS records one; and machine counters with the machine's name. An optional measure the adapter cannot take carries a reason, never zero. How a refused process is read is the adapter's own matter, on demand.

- **macOS** — native `proc_pid_rusage` counters with reaped children, `phys_footprint`, the responsible process as on-behalf-of, `.app` grouping, setuid `/bin/ps` for refused processes: all moved out of `posix/` into the macOS adapter.
- **Linux** — the native `/proc` reader exists (`usage.rs`: utime and stime with cutime and cstime, PSS); grouping by executable; no on-behalf-of; `/proc` gives other users' counters, so no fallback.
- **Windows** — the native reader exists without reaped children; reaped time comes from the execution's job object; grouping by executable.

These readers belong to a whole host adapter, and Linux and Windows have none yet (`composition/platform.ts` refuses to boot): terminals and commands wait on it, not only Load. This spec makes Load ask nothing of those adapters beyond the usage port.

**GPU.** A per-row GPU share is wanted, but no per-process source is proven: on 2026-10-31 the macOS IOKit per-client GPU time listed other processes but not Tagma's GPU process. A research step reads a per-process source for each OS — candidates: macOS IOKit accelerator clients, Linux DRM `fdinfo`, Windows "GPU Engine" counters — and the port gains an optional GPU measure only for a proven source.

## Work, in order

1. Usage port and the macOS adapter boundary: `.app` grouping, the responsible link and the `ps` fallback move into the macOS adapter; the fallback becomes asynchronous and on demand; the core loses every OS name.
2. Window declaration: desktop main declares, the server forwards, the host places; the environment variable and the parent check go.
3. On-behalf-of placement in the core.
4. Server rows and the app list: window parts with page and view names, one sorted Tagma list, idle folding, OS-neutral words, page close.
5. GPU source per OS, then the optional measure.

## Proof

- Placement through the host's load reading: with a server whose parent is not the window, the declared window's processes land in window rows; a declared pid with another birth stays outside; a launchd-parented service on behalf of a Tagma process is Tagma's; an execution's claim beats a window's.
- A usage-port double with no on-behalf-of, no reaped part and no GPU yields a consistent reading — the shape a new OS adapter starts from.
- No OS name or path (`darwin`, `.app`, `/bin/ps`, "Mac") outside adapters, judged by the enforced inspection.
- A desktop e2e in the testbed Electron lane: two built-in pages, one running a busy loop — its row carries the page's title and its renderer's CPU, and every window row counts inside Tagma's figure.
- Host pass cost with the other-programs section closed and open, before and after; no synchronous child process on the host loop.
