---
id: 01a16421-f7fd-7f0b-9955-d167e59f68a4
title: "An enabled navigation engine never stops on idle: after silence it returns collector garbage, keeping programs and type caches warm"
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/quiet.ts
  - kind: file
    ref: packages/navigation-ts/src/engine/workspace.ts
---
While navigation is on, a question after idle never pays the multi-second startup (the operator's decision), and TS 7 can neither store type caches nor return them fast: on runlith a stopped process answered the first heavy question 16 s after start, an engine with dropped checkers and kept parsed files in 9 s, and one that closed all programs in 31 s ([[8689cf64]]). So the process lives through idle, and its idle memory is warm state: the last questions' programs with their checkers.

Beyond warm state, idle holds Go collector garbage, which Go itself never returned to the system: after a question series the process memory stayed flat for minutes. So an engine with no question, warm-up, or edit intake for 30 s runs a full collection itself: the only door to `runtime.GC()` in the TS 7 API is `debug.saveHeapProfile`, whose profile file is deleted right away. The client collects next. The client source cache is never cleaned: cleaning it with the client collection freed about 0.3 GiB, but refilling it added half a second and more to the first questions after idle.

The holder's `rest` does not touch this timer's own worktree snapshots: `rest` releases them, as it knows which worktree was long unasked and what share of engine memory it holds. A released worktree stays connected, and its questions still go to the base snapshot, as before its own warm-up.
