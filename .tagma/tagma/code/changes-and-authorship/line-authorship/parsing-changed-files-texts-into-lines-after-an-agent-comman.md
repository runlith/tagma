---
id: 01a16603-f35a-79c5-af42-75212ddea043
title: Parsing changed files' texts into lines after an agent command holds the server event loop up to 0.5 s
ord: 58
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16604-27ae-790e-9bdf-5666d6c06b6f",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a10292-123c-7598-b815-bdae7a910861
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/folding.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/marks.ts
---
After an agent's command (`bash`), the server parses the changed files' texts into lines on the event loop and holds the loop up to ~0.5 s. The cost grows with file size, so on a large repository or large files the freeze is longer. This breaks the rule [[7a910861]]: the line walk already runs in `Walks` (`lines/walks.ts`, see [[363b3e55]]), but the version-text parse into the journal does not.

**Measurement 2026-10-22, build `head-20261022T233824436Z`, `telemetry.cpuSampler` on.**
- Freezes `f8455ebb` (499 ms, cpu) and `8346d124` (447 ms, cpu) during an agent's `bash`; the frame is the regex `/[^\n]*\n|[^\n]+$/g`.
- Profile `70643b3e` (2.8 s window): regex 158 ms self, `tokensOf` (`lines/marks.ts:210`) 248 ms total, `bufferOf` 68 ms, `shareText` (`lines/text.ts:7`) 42 ms; nearby native `update` 129 ms and `spawn` 92 ms — the profile never names their source.
- In the same trace `Holdings.judge` 3.4 s, `CheckoutRows.readRow` up to 4.5 s.

`tokensOf` is called on the loop: `lines/folding.ts` (104, 121, 312, 328–329, 419), `overlay.ts`, `selection.ts`, `owed.ts`, `released.ts`. Which caller produced this profile is not established.

**To do.** Find which path (most likely the command window's version intake in `folding.ts`) does this parse on the loop; first shrink the work to what changed, and hand what stays heavy to the owner's worker. Also name what `update` and `spawn` are in the same window, and move them off the loop when they grow with data.

**Proof.** A freeze on the same scenario (an agent command changing a large file) before and after: the loop never holds longer than ~50 ms on parsing; line authorship and landing give the same answers.

**Done (`0e5b361377`).** The profile's path is the Holdings judgement: `prepareAt` → `assembled` → `foldRowsOf` → `contentOf`. On the loop it parsed and re-hashed the text of every version of every unread record line, plus the HEAD and working-file bytes. The `update` in the profile is a repeated sha256 in `contentOf`: `versioned` passed the known digest as `blob`, not as `known`. The `spawn` is child-process launches (git through `NodeChildProcessSpawner`, `ProcessPool.connect` for sqlite-process); its cost grows with process count, not file size, and never changed here.
- Work is cut to what changed. A version's text is built once per digest per build, and only for lines past the folding's cached prefix. A version with the working file's digest takes its Content, and the digest-keyed store is not recomputed. The CR check is skipped wherever the line-ending rules are not yet read.
- The rest goes to `Walks`: decoding, digest, and parsing of the HEAD and working-file bytes (`file`), version texts (`content`), working-file check digests (`digests`), and the hunk step. The hunk step takes the window as shared text. The repeat window check on the loop is gone: the worker reconciles the hunk against the window of the same state.

**Measurement after.** A fixture `threadFilesWorld` with real walk workers (pool of 1). A 60,000-line file (5.3 MB) stands in HEAD, the agent edits it; the worst event-loop gap during judgement is measured. The driver counts the edit's hunk and digest before the window. One machine sample: "before" is HEAD code, "after" the delivery, 2 runs each.
- One edit: 16–56 → 3–11 ms.
- 5 edits at once: 33–64 → 5–7 ms.
- 4 files by 3 edits at once: 270–746 → 16–24 ms.
- Hunk over the whole file: 76–172 → 5–10 ms.

Verdicts and hands match. A landing's `submit_work` still parses texts on the loop separately — that is [[cbb0f9bb]].
