---
id: 01a14c13-c481-7acc-8aa6-03b58c7d795b
title: A file diff shows the holder of every changed line — for the working change, its halves, a commit, and a range
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/DiffReading.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/DiffTab.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/HandsInFile.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/PictureDiff.svelte
  - kind: file
    ref: apps/tagma/server/src/change-record/contract/wire/authorship.ts
---
**Value.** The operator and agent see in a file change not only what changed but who wrote it, and jump to the author thread in one click.

**How.** The diff tab on the Checkout page and in the thread's stage beside the conversation; the `read_authorship` operation for the agent.

**Behaviour.**
- The working diff runs from HEAD to the on-disk file, and every changed line carries its holder: a thread, the operator ("You"), or nobody. Holders are listed in the header with line counts, each with its own gutter shade; a thread opens by click.
- The halves separately: staged — HEAD vs index, unstaged — index vs file. A single commit's diff and a revision range's diff are read from git alone and carry no authors.
- Collapsed unchanged chunks open one by one without expanding the rest; symbols shifted inside a line are highlighted.
- Images compare as images; the diff width can be switched.

**Limits.** Lines HEAD already carries get no authors: this is no history blame. A too-wide answer refuses and asks to narrow context; a binary file arrives without lines.
