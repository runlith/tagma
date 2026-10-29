---
id: 01a14c13-c481-7acc-8aa6-03bfd37a7e83
title: The operator pulls, pushes, publishes the branch, and aborts a stuck git operation from the Git tab
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ba0a234a8f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/Repo.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/pullMerge.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/gitWrites.ts
  - kind: symbol
    ref: apps/tagma/server/src/workspace/contract/wire/checkoutActs.ts
    symbol: CHECKOUT_ACT_OPERATIONS
---
**Value.** Syncing with the remote needs no terminal and doesn't risk agents' unfinished work in the same tree.

**How.** The Publish, Pull, or Push button in the Git tab header — by branch state; Fetch; the running-operation banner with Resolve and Abort. The `fetch_checkout`, `pull_checkout`, `push_checkout`, `abort_checkout` operations.

**Behaviour.**
- Pull takes only the branch upstream and always merges — never rebases and stashes nothing, whatever the config says: rebase would rewrite commits the accounting references, and stash would take others' lines. A diverged branch gets a merge commit in the commit tree, and the checkout moves only after publication.
- A conflict is no refusal: the merge stays in progress in the checkout itself, the answer names paths and the threads writing them. Resolve opens the first conflict, a commit finishes the merge, Abort breaks off merge, rebase, am, cherry-pick, or revert.
- Push never forces; Publish puts a branch without upstream on the default remote and records upstream. Fetch moves only remote-tracking refs, with prune.
- Git asks for no password: a remote needing an unavailable secret refuses instead of waiting.

**Limits.** Abort irreversibly discards conflict resolutions and asks for confirmation. Local edits a merge would overwrite refuse pull in git's words — after fetch already. The agent doesn't get these doors as tools.
