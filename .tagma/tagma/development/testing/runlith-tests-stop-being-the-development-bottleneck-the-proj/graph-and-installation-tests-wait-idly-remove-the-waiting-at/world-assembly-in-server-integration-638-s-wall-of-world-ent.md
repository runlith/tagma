---
id: 01a17b68-34fb-7d49-8896-efb859f7aee6
title: "World assembly in server integration: 638 s wall of world entries — file hooks and the queue under overload, not build waiting (2026-10-27)"
ord: 1
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/doorFixture.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/fixture.ts
---
Measurements of 2026-10-27, Apple M2 Max, 12 cores, Bun 1.4.4, a shared checkout with neighbours; each — one sample. Source — the `integration-n8-pair` report (757 files, 8 workers, load 7 → 49 over the run) and single `--parallel=1 --no-isolate` runs at load 7–14.

**What the 638 s wall and 386 s CPU of the world entry consist of.** A `file` line's world entry is all of the file's hook time outside tests, not just world assembly. World assemblies (`world` lines with `built: true`) — 192 s wall and 79 s CPU: shared DoorFixture — 8 builds, 51/18 s; own DoorFixture — 8 builds, 54/20 s; TerminalFixture — 5 builds, 40/12 s; own EnsureServer — 16/8 s. The other 446 s wall and 307 s CPU are file hooks: project birth (`stealthProject`), `projectLeaving`, and group layers, most in `composition/testing/threads` (110/71 s), `http` (65/47 s), and `native-harness` (40/25 s).

**There is nearly no waiting in worlds: the wall/CPU gap is the queue under overload.** A single door-world assembly — 3.7 s wall at 2.95 s CPU with children; a terminal-world one — 4.15 at 2.95 s. `birthAuthority.itest.ts` alone spends ~0.6 s wall and ~0.24 s CPU on hooks outside assembly, but as a worker's 33rd file in the run — 12.7 s wall and 6 s CPU; the body — 0.4 s vs 13.9 s. CPU grows the same way in [[026f978d]]: that is no world background.

**Where the world really waits.** The runtime assembly (`composition.runtime`) raises the execution host: the holder, `bun host.js`, and two pre-launched `child.ts`. About 0.6 s of child CPU goes to that, and up to ~0.7–1.2 s of waiting on its answer per assembly. That is 8–13 assemblies per run, i.e. seconds over the whole set, not per file. Lazily raising the host to the first command changes the product's boot in `executions/assembly.ts` and was not done here.

**The task's files alone** (file wall / CPU): storageById — 4.4/5.3 s; copies — 4.9/5.4 s; mirror — 2.1/4.0 s; commits — 2.6/3.3 s. No waiting in them: 10–17 s in the run is the queue for a core. idleCopies — 11.4/9.8 s: two runtime loads, the test's subject. release — 6/1.5 s: the release steps copy runtime, typescript, and native modules and launch bun; honest work. In dmg every hdiutil step (create, convert, attach) waits 3–4 s at 0 CPU inside macOS. The test itself paid one more image-checksum check at attach — removed in d9487ddad0: neighbouring runs 10.5 → ~8.2 s.
