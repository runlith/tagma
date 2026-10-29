---
id: 01a17b4c-9117-77c3-8bea-fc74026f978d
title: "Testbed workers curve: world background did not explain the fivefold CPU; machine overload changes file cost and throughput"
ord: 66
edges:
  - kind: discovered-from
    to: 01a17b03-a13b-7f89-877a-c88bd6678b58
---
Measurements of 2026-10-27 on Apple M2 Max, 12 cores (8P + 4E), 32 GiB, Bun 1.4.4. Each launch is one sample in the shared checkout with agents working alongside. HEAD and others' uncommitted files changed; results attributed to no single optimization. `uptime` includes the run's own load, not only neighbours'.

## Testing the remaining-background hypothesis

Order taken from worker 98859's report in the reference measurement: files 72–78 — commandNotice, conversations, declaredAgents, delegation, developerRollout, landing/submit and enforcement/moduleStale. A: submitEqualLines alone; B: those seven files then submitEqualLines, `--parallel=1 --no-isolate`. The report confirmed the order. Four adjacent launches, load about 4–5:

| Launch | Target file CPU, s | Body CPU, s | git |
|---|---:|---:|---:|
| A1 | 12.682 | 8.865 | 769 |
| B1 | 11.107 | 8.598 | 767 |
| A2 | 12.834 | 9.100 | 767 |
| B2 | 10.881 | 8.341 | 776 |

The difference did not reproduce. DoorFixture does not yet build in those seven neighbours, so the whole prefix 1–79 of the same worker additionally launched: target file 9.644 s CPU, body 9.582 s, 829 git. The full prefix had 537 pass, 8 skip, one old read_output.wait test failed during its foreign migration, one more fail came from broken profiling. This is a cost measurement, not a green check of the whole prefix. A large tax of the remaining worlds explaining the former 59.7 s CPU of the target file is not confirmed. Extra individual git launches exist but do not explain the CPU difference by themselves.

## Load changes CPU seconds too

The same file launched A B A B: A with no added load, B with 12 own purely-computational nice-10 processes, no runtime worlds; the processes finished with each launch. A was no silence: others' work continued on the machine.

| Launch | File CPU, s | File wall, s | git |
|---|---:|---:|---:|
| A1 | 21.44 | 18.77 | 790 |
| B1 | 21.18 | 24.42 | 804 |
| A2 | 18.28 | 15.10 | 772 |
| B2 | 22.04 | 31.66 | 801 |

In the first pair CPU nearly equal; in the second it grew 20.6%, wall 2.10×. Purely computational load did not reproduce the fivefold CPU. During the full N8, `proc_pid_rusage(RUSAGE_INFO_V6)` showed 65.2–69.2% CPU on P-cores for eight workers, the rest on E; that is a fact of this window, not proof of the E-core share in the old measurement. The testbed live-counter units separately verified against process.cpuUsage on a 200 ms computation: 131.720 vs 131.681 ms, ratio 1.0003.

The tests skill fixed the unconditional "CPU is comparable under load": CPU and wall compare under similar load, and a ratio across different conditions does not prove code cost.

## Full server integration commands

Each point launched with one command `bun run test:all --package apps/tagma/server --script test:integration`, with `--jobs N` for 4/6/8; parts never combined or resumed.

| Workers | Runner wall, s | Files with a finished line | Files/min | Outcome |
|---|---:|---:|---:|---|
| 10, former default | 600.15 | 482/757 | 48.19 | stopped by the life rule |
| 4 | 596.09 | 755/757 | 75.99 | stopped; pageComposition and claudeCut did not finish |
| 6 | 596.73 | 756/757 | 76.01 | stopped; push/delivery did not finish |
| 8 | 377.16 | 757/757 | 120.43 | set finished, exit 1 |

Total CPU of the finished N8: 1815.74 s. For cut sets CPU is not issued as the cost of the whole set. In the table, throughput is finished files over the command's actual time, not a claim of full passage.

Shared cohort: 452 files with pass and identical test counts at all four points. Sum of their file CPUs (not whole-set CPU): 2068.46 / 1328.98 / 1566.36 / 1481.58 s for 10 / 4 / 6 / 8 workers. So N4 is cheaper on comparable files and finishes them no slower than N10; N8 gives the best observed throughput. For the target submitEqualLines at N10 and N4 git is equally 883, but CPU 47.636 vs 14.864 s, wall 118.254 vs 13.903 s.

At N10 the machine was saturated, memory under pressure warning: the set held about 11.6 GiB. In the N4 window the set held about 5.1 GiB, pressure normal. These are two windows, not peak measurements of all points. Worker count does not equal busy CPUs and does not describe the memory of their git, SQLite, hosts, watchers and shared worlds.

The first N4 attempt excluded from the table: a parallel wide check:change of a child agent held eight slots, and the real launch got only two workers. Both commands stopped, N4 repeated after removing that condition.

## Extra adjacent pair

Before the formula change, N8 and the old N10 default taken back-to-back:

| Workers | Runner wall, s | Runner CPU, s | Files | Outcome |
|---|---:|---:|---:|---|
| 8 | 511.30 | 2145.34 | 757 | pass, 3443 tests |
| 10 | 599.87 | 1864.52, partial | 754 | stopped, code 143 |

Throughput: 88.83 vs 75.42 files/min. But across 725 shared pass files with identical test counts, N10 CPU is lower: 1960.22 vs 2090.59 s, median ratio 0.935. The repeat does not confirm a universal growth of file cost with worker count. Load before N8 and after: 7.25 → 49.57; before N10 and after: 32.10 → 9.85; strictly identical external load not obtained. The curve justifies a conservative default, not each machine's and set's optimum.

## Adopted default

Budget: the minimum of 2/3 of available cores and half the machine's memory with a 2 GiB envelope per worker including children, at least one worker; the former minimal reserve for interactive work kept. CLI, test:all and check:change read one formula. On 12 cores / 32 GiB that is 8, on 8 cores / 8 GiB 2, on 64 cores / 256 GiB 42. This is an envelope for admission, not a ban on a test spawning more children and not a guarantee of its memory upper bound.

Cores read availableParallelism, memory the lesser of totalmem and positive process.constrainedMemory. In Bun 1.4.4 constrainedMemory comes from WTF::ramSize; in WebKit revision d6375c72affe0f70222cdcb45012b10f0bf3a9d5 the Linux branch of AvailableMemory.cpp caps sysinfo at the uv_get_constrained_memory result, the Mac branch reads kernel memory. Linux behaviour verified here from source, not a live Linux run. [Bun source](https://github.com/oven-sh/bun/blob/bun-v1.4.4/src/jsc/bindings/BunProcess.cpp#L3613-L3616), [this revision's WebKit memory](https://github.com/oven-sh/WebKit/blob/d6375c72affe0f70222cdcb45012b10f0bf3a9d5/Source/WTF/wtf/AvailableMemory.cpp#L71-L94).

## Separate defects and result limits

The full-prefix profile first got lost: closing the disabled CpuProfiler attached and detached the inspector Session, stopping Bun's external recording. Fix at the owner: commit b88d352967, proved red-green through the public layer; preload unchanged. This is a measurement-reliability fix, not a claimed set speedup.

The red installedConfig and terminalHistory from N4 handed to the parent agent. In the first N8 most new reds were caused by others' live edit with `Export named 'inNodeModules' not found`; its effect excluded from the identical pass cohort. A set with such reds is not called green and does not prove this delivery's correctness. The cut N4's error text lost test:all, which wrote the log only on completion; the log-saving defect fixed separately.

All reports, git-sites, load-probe.ts and curve.ts in `~/.tagma-dev/scratch/01a17b03-b000-7845-9386-0b5c969fce44/`. Main reports: a1-valid.jsonl, b1.jsonl, a2.jsonl, b2.jsonl, prefix.jsonl, load-A1/B1/A2/B2.jsonl and integration-{before,n4-valid,n4,n6,n8,n8-pair,default-pair}.json.d directories. Each set's JSONL named `apps%2Ftagma%2Fserver%3Atest%3Aintegration.jsonl`; finished launches have a .log beside. Commands and HEAD changes kept in the thread's records.
