---
id: 01a14c13-c481-7acc-8aa6-03c0e4e2e9fe
title: Branch and path history and any commit's contents read in the Git tab, palette, and by the agent
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a640beeb16
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CommitFiles.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CommitList.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CommitStep.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/PathCommits.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commits.feed.svelte
  - kind: file
    ref: apps/tagma/server/src/landing/presentation.ts
  - kind: symbol
    ref: apps/tagma/server/src/workspace/contract/wire/checkoutReads.ts
    symbol: CHECKOUT_OPERATIONS
---
**Value.** The operator and agent find when and by which commit a file changed and what the commit brought, without leaving Tagma.

**How.** The Commits section at the bottom of the Git tab with commit expansion down to files and their diff; commit search in the palette by message text; a commit from the thread panel opens in the Git tab; the agent's commit step in the feed expands with the same file list, and a file opens its diff in that commit in the thread's Changes tab. The `read_checkout_history` and `read_commit` operations.

**Behaviour.**
- HEAD log or commits touching one path — newest first, in pages; continuation keeps the first page's head, so a commit landing mid-read doesn't shift rows. Search is a case-insensitive message substring.
- Graph sync commits are marked and collapsed so they don't obscure work.
- A commit answers with paths from the first parent with status, line counts, and paired renames; can narrow to paths one thread's accounting marked with that commit.
- The feed's commit step knows its checkout and full hash from the landing view (the `commit` link), so it reads files even when the landing answer in the feed is trimmed. Above the list it puts what only the landing knows: "formatted" on files the commit steps rewrote, "with …" on files with other holders' lines, and "Left uncommitted" if its own remains; this leads into the Changes tab's Now. Files read only at an expanded step. A step without a link — "Nothing to commit", a refusal, and records before it — doesn't expand with a list.

**Limits.** This is history, not blame: which line came from where, it doesn't say. Reads work over any registered machine project's checkout.
