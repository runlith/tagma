---
id: 01a14c4e-7d20-7f6a-b9ef-01d9f2931c99
title: Whether to show a file diff at all without waiting for the Holdings judge
ord: 4
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Whether to show a file diff at all without waiting for the Holdings judge.

After [[49c55a3e]], opening a diff waits for one background slice to be prepared and for its own path's judge. The question is whether display should stop waiting for the judge at all.

**Why not taken at once.** A standing verdict cannot be shown as-is while the judge runs: line holders are computed over the bytes the verdict is built from. After a new record lands in the file, the old holders would fall on the new lines incorrectly.

**Two honest options.**
- **A current verdict.** Holdings answers display from the standing record when the path is not queued and its working bytes and blob in HEAD match the ones the verdict is built from. Risk: line-ending rules (`.gitattributes`) and index letters arrive from the watcher asynchronously, and such an answer does not vouch for them. Landing stays on a fresh judge in any case.
- **Authors follow.** The diff arrives at once without authors, and authors arrive with a second read after the judge. The answer never lies, but the wire and the client change and the file is walked twice.

**What decides.** The opening measurement under agent load after [[49c55a3e]] and [[687ec37e]]. When p99 fits in fractions of a second, the question closes unbuilt.
