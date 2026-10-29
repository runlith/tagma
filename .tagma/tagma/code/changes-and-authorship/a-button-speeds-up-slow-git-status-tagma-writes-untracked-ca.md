---
id: 01a14c13-c481-7acc-8aa6-03c14b093139
title: "A button speeds up slow git status: Tagma writes untracked cache and fsmonitor into the repository config and removes only its own settings"
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/FastStatusOffer.svelte
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/fastStatus.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/contract/wire/settings.ts
---
**Value.** In a large repository, `git status` — the operator's, agents', and Tagma's own — stops walking the whole tree.

**How.** The project `checkout.untrackedCache` and `checkout.fsmonitor` settings (the Git section); the Git tab itself offers to enable untracked cache when checkout reading is slow.

**Behaviour.**
- Enabling writes the key into the repository's local config and a mark that Tagma wrote it; disabling removes only what Tagma wrote and stops the fsmonitor daemon.
- A value already present in any git config isn't overwritten: a different value causes the switch to be refused, with its location named.
- fsmonitor turns on only where the git build carries its own monitor (macOS and Windows); it pays off in repositories of hundreds of thousands of files and costs a background process per worktree.
- The Git tab offer closes with a cross and isn't shown again.

**Limits.** The keys are set on the project, not the user.
