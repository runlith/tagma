---
id: 01a14d8a-0f78-73df-81be-ec30dab1641f
title: "How accurate command-edit authorship without root is on macOS: who the nobody's lines' candidates are, \"writers beat readers\", DYLD interception, counters and snapshot cost — measurements of 2026-10-18"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "runlith main checkout: read_changes, read_commands, read_performance; tagma.sqlite database (command.measurement, workspace_change) read-only; project 5 thread rollouts; dylib/bash/rusage/fd probes in scratch on macOS 26.0.1 M2 Max",
      "ref": "runlith HEAD ~199371425 at 2026-10-18 05:40 UTC; bun 1.4.3, git 2.50.1 Apple, bash 5.2.37 built from sources"
    }
  }
edges:
  - kind: relates
    to: 01a10323-2fc7-78fa-8d6d-620a6ce62961
  - kind: relates
    to: 01a111ab-9639-7730-81d5-593018d06fb3
  - kind: relates
    to: 01a116e8-e341-7861-a5f6-564c65835438
---
Measurements of 2026-10-18 04:50–05:40 UTC on the operator machine (Apple M2 Max, 12 cores, macOS 26.0.1, SIP on, load average 12–13 from parallel agents — all timings noisy, one sample). No product code changed; the analysis probes and scripts lived in thread 01a14d6a's scratch and vanish with it — this record alone cannot be reproduced, only repeated from scratch.

## What stands in the way

A holdings slice of main runlith (`read_changes path "."`, 05:25 UTC): 32,802 nobody's lines (all `overlap`) against 15,219 with an owner, 165 paths. Candidates are recovered from the command journal (`read_commands`, 17,400 records over 24 h; 5,327 of them `bash` in main) and the path's mtime on disk ± 20 ms; provably reading commands (`shellReadsOnly`, 2,508 of 5,327) are never candidates.

| what the path mtime showed | lines | share |
|---|---|---|
| ≥ 2 threads lived at record time (the analyzable part) | 23,759 | 72.4% |
| one thread lived — the last record is not the one that went to overlap | 7,820 | 23.8% |
| no one from the registry | 1,143 | 3.5% |
| file deleted | 80 | 0.2% |

27.6% of nobody's lines cannot be resolved by mtime: overlap happened on an earlier record of the path. Method shares below are given of all 32,802 lines and of the 23,759 analyzable ones; for the rest, that the distribution is the same is unverified.

## 1. Who the candidates are

Classes by command text (the `shellCommands` parser from agent-tools plus loop and `xargs` handling; the classifier is a trial one, in scratch). Unique candidate commands of the analyzable paths:

| class | commands | duration p50 / p95 | lines with the class among candidates |
|---|---|---|---|
| format-fix (almost all `oxfmt --write <files> && bun check/test`) | 63 | 4 / 72 s | 22,351 |
| test (`bun test`, loops over `*.itest/stest`) | 54 | 40 / 200 s | 16,744 |
| typecheck (`bun check`, `bun run typecheck`) | 36 | 63 / 277 s | 14,907 |
| other (headless Chrome, `xcrun notarytool`, `docker run`) | 6 | 590 / 600 s | 4,166 |
| script (`bun x.ts`, `python3 -c` in a pipeline, `bun -e`) | 8 | 23 s / — | 2,610 |
| read-redirect (polling `curl`/`sleep`, reads with `$()` or redirect outside the checkout) | 10 | 81 / 156 s | 1,503 |
| tagma-op, fs-mutate, git-write, install, build | 7 | — | ≤ 708 each |

Thread count at record time (lines): 2 — 14,435; 3 — 5,634; 4 — 3,317; 5+ — 373.

The typical window of a nobody's edit: a short writer of one agent (oxfmt, a script, `perl -pi`) inside minute-long `bun check` / `bun test` runs of two or three other agents. Long candidates are readers by appearance.

**Upper bound of exact bun/node write-sets.** Excluding every candidate whose processes are bun/node (tests, typecheck, formatter, bun scripts) and who never wrote that path, and leaving opaque only commands with system writers (`sed -i`, `perl`, `python`, `mv/cp/rm`, git writes, redirect into the checkout), 23,033 lines become unambiguous: 70.2% of all and 96.9% of analyzable ones.

## 2. `DYLD_INSERT_LIBRARIES` interception (verified by probes)

An interposition library was built (`__DATA,__interpose`: open/openat and their `$NOCANCEL`, creat, rename*, renamex_np, unlink*, mkdir*, rmdir, link, symlink, truncate, clonefile*). The record path comes from `fcntl(F_GETPATH)` on the open fd.

Whether the variable survives (`DYLD_*` in the process environment and a journal record):
- `/bin/sh -c`, `/bin/zsh -c`, `/bin/bash -c`, `/usr/bin/env sh` — **no**: SIP cleans `DYLD_*`, and the shell's children never receive it (`bun → /bin/sh → bun` — 0 records);
- a copy of `/bin/sh` outside `/bin` — killed (SIGKILL, exit 137): a system binary cannot be "unlinked" by copying;
- own bash 5.2.37 built from sources (ad-hoc signature): the variable lives, the shell's own redirect is visible;
- bun 1.4.3 and node (nvm, Homebrew): `writeFileSync`, `Bun.write`, `fs.promises`, `rename`, `unlink`, `copyFile`, `Bun.spawn` children, Bun Shell (`Bun.$`), records from `bun test`, the `toMatchSnapshot` snapshot are visible. Both binaries are hardened runtime but carry `allow-dyld-environment-variables` and `disable-library-validation`;
- `bun run <script>` — **no**: the script goes through `/bin/sh`; with `bun run --shell=bun` — yes; `bunx … biome` — no, the biome binary itself (ad-hoc) directly — yes;
- system `/usr/bin/sed -i`, `perl -pi`, `mv`, git from Xcode, a script with a `#!/bin/sh` shebang, BSD `xargs → bun` — **no**;
- hardened without entitlement (the Claude Code binary) or with `allow-dyld` but without `disable-library-validation` — the library silently never loads, the process keeps running;
- **breaks**: an arm64 library in an x86_64 process (Rosetta) — dyld kills the process (Abort trap 6). A universal arm64/arm64e/x86_64 build works.

Overhead (medians of 15 alternating runs of /bin/sh · own bash · own bash + library; run-to-run spread ±20–50% under load):
- process start `bun -e 0`: 16 · 16 · 24 ms — about +8 ms per process (dyld never defers loading an image with interpose tuples);
- `bun test` of the paging package (30 tests): 116 · 125 · 131 ms;
- `bun run --shell=bun test`: 176 · 139 · 177 ms;
- 10,000 `writeFileSync` from bun: 1,208 · 1,053 · 1,249 ms — within noise at 10,000 journal records;
- `git status` (opaque): 117 · 119 · 120 ms.

Conclusion (a conclusion, not a measurement): interception gives an exact write-set only in a subtree without system binaries. For it to work, the host runs the command with its own shell, the library rewrites exec of `/bin/sh` and shebang scripts to it, and the host checks which processes of the tree reported back, leaving the silent ones as opaque candidates. The `sed`/`perl`/git/`mv` writers stay opaque — but those are the writers, and the readers are who must be excluded.

## 3. Process write counters

`proc_pid_rusage(RUSAGE_INFO_V4)` on a zombie before reap and `wait4` rusage:
- a leader with one command (the shell does exec): `bun test` of paging, `rg`, `git status --no-optional-locks`, `git log` — 0 bytes; recording one byte from bun — `ri_diskio_byteswritten` 4,096, `ri_logical_writes` 24,576;
- the same record in a child (`true; bun -e …`) — the leader shows 0: only its own counters, reaped children are lost; `ru_oublock` from `wait4` — 0 in all cases;
- a child's counter can only be read while it is alive; the host never catches a short process in time.

Counters would only exclude candidates that never recorded a byte anywhere. Runlith tests (sqlite in a temp directory) and typecheck (`incremental`, `tsBuildInfoFile: dist/.tsbuildinfo`) write by design — concluded from configs, their counters never measured. The unit tests, `rg` and `git status` excludable by counter are readers anyway. Estimate: almost nothing above "writers beat readers".

## 4. More without root

- Polling open fds (`proc_pidinfo PROC_PIDLISTFDS` + `PROC_PIDFDVNODEPATHINFO`) of a process recording 2,000 files: polling every 1 ms notices 23 files (1.2%), every 10 ms — 1 (0.05%). An ordinary record holds an fd for microseconds — the method is useless.
- **Named targets**: a formatter or `sed -i`/`perl -pi` with literal paths in argv only ever records those. Alone it resolves 1,775 lines (5.4% of all, 7.5% of analyzable).
- **Process phase** (which process of the command lived at moment t): from "`oxfmt` → `bun check`" usually only `bun check` still lives at record time. The host could know this from the process tree with argv and lifetimes. Estimated through a 5 s window for a leading `oxfmt`: +497 lines (+1.5 pp) above "writers beat readers" together with named targets.
- Without root, EndpointSecurity (root and an Apple entitlement), `fs_usage` and DTrace (root/SIP) are unavailable; FSEvents and kqueue never name a process (per documentation).

## The operator's method: "writers beat readers"

Rule: when the candidate threads include a writer by appearance, readers (test, typecheck, lint without `--fix/--write`, build, reads with redirect outside the checkout or `$()`) are not candidates. One reader still receives its own edit.

**(1) The share of nobody's lines the rule resolves:** 13,516 lines — 41.2% of all, 56.9% of analyzable ones. Together with named targets — 16,088 (49.0% / 67.7%). Remaining are 2,817 lines where every candidate is a reader (8.6%: usually a test or `bun check` of several agents plus an out-of-registry writer), and about 4,850 (14.8%) with several writing threads.

**(2) How often a reader really records an unignored path.** Change-record history 2026-10-11 01:12 — 2026-10-18 05:32 UTC: each command's summary (`command.measurement`) and `workspace_change` lines. Durations come from 151 threads' rollouts.
- 4,501 reader-class commands; 470 of them received at least one edit of their own ("attributed to this session"), 454 with a known duration;
- 40 — a writing command of the same thread ran nearby; 414 — the command was its thread's only candidate;
- of the 414, 398 record lines are the same thread's typed edits (`edit`/`write` of the agent while typecheck ran): the command summary counts them as "own", the command never recorded;
- 16 of 414 with a record but no typed call: 1 — a real reader record (`RUNLITH_TEST_REPORT=1 bun test` created the file `apps/tagma/cloud/1`); 2 — classifier misses (`cat >> file <<EOF`, `node node_modules/.bin/oxfmt`); 13 — out-of-registry writers: temporary `.merge_file_*` at the checkout root (before the filter in `porcelainListing`), deletions at worktree merge, outside-CLI and editor records.

The rule's error rate on this history: confirmed 1 / 4,501 (0.02%) reader commands, upper bound 16 / 4,501 (0.36%). Outside the single-candidate sample one more real case was noticed: `cargo build` rewrote `Cargo.lock` (in the current slice it is overlap rather than the only candidate). Ignored paths (`dist`, `.tsbuildinfo`, `target`) are never recorded at all and never counted. What the sample never establishes: a reader recording while another thread's writer lived now goes to overlap and never enters this rate — the assumption that the rate is the same there is unverified.

A new error kind, unmeasured: an out-of-registry record while a reader overlaps a writer is handed by the rule to the writer rather than to nobody. Among single-reader windows such records are 13 of 414 (3%).

**Classification cost:** `shellReadsOnly` — 7 µs per command, the classifier with parser — 11.6 µs (20,000 most recent commands, line p50 178 chars, p99 1,170). Computed once when a life opens, outside the answer path. By command text: 49.0% — provably reading, 17.4% — test, 9.1% — read-redirect, 7.5% — script, 6.2% — typecheck, 3.7% — format-fix, the rest ≤ 3% each.

**Disputed classes:**
- `cargo build` (records `Cargo.lock`);
- a test with `-u`/`--update-snapshots` or with a report path in an environment variable;
- `python3 -c` in a pipeline (usually reads stdin but can record);
- `curl -o`, `docker run -v <checkout>`, headless Chrome and `xcrun notarytool` — actually readers, but 600-second ones: as "writer" class they would beat everyone;
- `bun <script>.ts`, `tagma op`;
- `bun run <script>` — the script content is invisible by text;
- shell loops and functions `shellCommands` never parses (fallback by regex);
- `xargs <writer>`.

## 5. The wrapper cost now

Server telemetry, 36 hours to 05:00 UTC, about 12,950 `bash` calls (`read_performance metrics`, power-of-two buckets):
- `ShellRun.open` (the "before" snapshot plus life opening): mean 175 ms, p50 64–128 ms, p95 256–512 ms, p99 1–2 s;
- `ShellRun.finish` (the "after" snapshot plus decision): 135 ms, p50 64–128 ms, p95 256–512 ms;
- the bulk of both is `CheckoutBaselines.checkoutState` (`git status --porcelain -unormal` plus digesting dirty paths): 111 ms mean per snapshot, p95 128–256 ms; `git status` on runlith now takes ~120 ms (28,865 files in the index, 214 dirty);
- `BashTool.preflight` — 2 ms, `ShellRun.movesOf` — < 1 ms.

So about 310 ms per `bash` call on average; on short commands that is the main answer latency. Telemetry never splits commands with no changes apart; `movesOf` < 1 ms, so the cost is the same without changes.

Estimate (not a measurement): an observation-process cursor (`FileWatcher.mark`/`changedSince` from `packages/watch`, the same mechanism as the graph's cold tree — [[ec0b8911]]) instead of `git status`. A snapshot would become one IPC question, `rev-parse HEAD` (~10 ms) plus digesting only changed paths: ~10–20 ms when nothing changed, i.e. −250…−280 ms per call. Caveats: the watcher never sees the index or `.gitignore`; stat checks those; on cursor loss a full status is needed. This continues [[6ce62961]] with a different change source.

## 6. Linux and Windows — per documentation, unverified

- **Linux.** `LD_PRELOAD` inherits with no SIP analogue; it fails on static binaries, Go with direct syscalls, and setuid. fanotify without `CAP_SYS_ADMIN` is available since 5.13, but the recording PID is never reported to an unprivileged listener ([fanotify_init(2)](https://man7.org/linux/man-pages/man2/fanotify_init.2.html)). inotify never gives a PID. seccomp user notification and ptrace work without root for one's own children but cost a context switch per intercepted syscall. `/proc/<pid>/io write_bytes` has the same limits as rusage.
- **Windows.** There is no `LD_PRELOAD` analogue; DLL injection into one's own child processes (Detours, `DetourCreateProcessWithDllEx`) needs no admin rights. ETW file I/O and minifilter need an administrator; the USN journal never gives a PID. `GetProcessIoCounters` is counters, like rusage.

## Method comparison

| method | nobody's lines resolved | speed | breakage risk | complexity |
|---|---|---|---|---|
| writers beat readers (by text) | 41.2% of all / 56.9% of analyzable (measured on the slice) | 7–12 µs per command at life open, outside the answer path (measured) | 0.02% (confirmed) … 0.36% (bound) of reader commands misattributed; disputed classes above | small: life role in `Lives` and a rule in the decider |
| + named format-/`sed`-command targets | 49.0% / 67.7% (measured) | same | a wrong argv parse misses the path; literal paths are checkable | small |
| + host-tree process phase | ~50.6% / ~69.8% (5 s-window estimate) | polling the tree already runs; recording argv/lifetimes — unmeasured | short processes slip past polling | medium |
| exact bun/node write-sets via `DYLD_INSERT_LIBRARIES` + own shell | ≤ 70.2% / ≤ 96.9% (upper bound) | +~8 ms per process start; at 10k records within noise (measured) | x86_64 without a universal build dies (verified); `/bin/sh` and system binaries outside coverage; hardened binaries without entitlement silently outside coverage | high: a dylib and shell on 3 OSes, signing, exec rewriting, tree-coverage checks |
| rusage counters | ≈ 0 above the rule (concluded from probes) | cheap | — | small but useless |
| fd polling | ≈ 0 (1.2% of records at 1 ms) | expensive | — | — |
| watcher cursor instead of `git status` | 0 (speed, not accuracy) | −250…−280 ms per `bash` call (estimated from the 310 ms measurement) | external-edit correctness, cursor loss | medium |

## Recommendation — a ladder

1. **Now: "writers beat readers" with named targets.** Resolves about half the nobody's lines and two thirds of analyzable ones; cost is microseconds; measured error ≤ 0.36% of reader commands. Disputed classes default to writers, except explicitly reading long ones: headless browser, `notarytool`, `curl` polls without `-o`. `cargo build|test|check` is only a writer of `Cargo.lock`; a test with `-u` or a report path in env is a writer. The role is computed by `shellShapes` (agent-tools) at life open; `Lives.decider` drops readers while a writer remains, plus named writers whose set lacks the path.
2. **Separately, for speed:** snapshots through the watcher cursor. It changes no accuracy but removes ~0.3 s from every `bash`.
3. **Later, when the remainder hurts:** host-tree process phase (+1–2 pp, estimated).
4. **Last and only on proven need:** interposition. It yields up to ~97% of analyzable lines but needs its own shell, exec rewriting of `/bin/sh`, a universal signed library, and analogues on Linux and Windows; after steps 1–3 the remainder is at most ~30% of analyzable lines — an upper bound.
5. Never take counters or fd polling.
