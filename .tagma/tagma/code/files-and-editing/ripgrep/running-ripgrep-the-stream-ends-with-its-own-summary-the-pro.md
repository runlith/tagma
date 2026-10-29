---
id: 01a11803-2cd3-736e-b33a-a7b0bb7fe73b
title: "Running ripgrep: the stream ends with its own Summary, the process is put out down the stop ladder, the kit counts ranges and columns"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/ripgrep/src/run.ts
---
The `searchContent` and `listFiles` stream always ends with a `Summary` event, which the kit builds from the exit code rather than taking from ripgrep: `partial` is a non-0, non-1 exit with the answer already received. Code 2 with no `summary` in `--json` (for `--files` — with not one path and with stderr) is a `SearchFailed` with all stderr lines containing "error", space-joined: for a regex parse error the first such line is only the `rg: regex parse error:` header, and the cause stands below as an `error: …` line; a partial walk with an answer is no failure, the caller shows "some paths unavailable".

The ceiling and cancellation interrupt the stream and put the process out: SIGINT, then SIGTERM via `terminateAtMs`, then SIGKILL (on Windows — `kill` with `forceKillAfter`). The spawner's finalizer can wait on the exit forever, so the process is put out on a separate fiber, and the stream waits on it no longer than the ladder: "an answer after cancellation no later than the ladder and with no remaining process" — checked on a child that ignores INT and TERM.

Starting the process itself is interruptible: the acquire in `acquireRelease` runs uninterruptibly, and a spawner whose spawn never completes would hold the stream past the ceiling and cancellation, so the process is taken as an ordinary stream step and put out by the stream's finalizer.

`--json` does not apply `--max-columns`, so the kit does the column trimming and the `submatches` recompute from UTF-8 byte offsets into UTF-16 indexes: `Match.text` is already the displayed text, and `ranges` never leave it.
