---
id: 01a14c13-c481-7acc-8aa6-03becb6e09e1
title: The operator commits the index from the Git tab — with amend, commit and push, and without steps after their refusal
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b9332b5b81
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ba0a234a8f
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03bd4ccde6e8
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CommitBox.svelte
  - kind: file
    ref: apps/tagma/server/src/landing/land/indexCommit.ts
  - kind: symbol
    ref: apps/tagma/server/src/landing/contract/wire/checkoutCommits.ts
    symbol: CHECKOUT_COMMIT_OPERATIONS
---
**Value.** The operator records staged changes without leaving for a terminal and gets the same commit `git commit` would give: with their identity, hooks, and signature, in the repository's step form.

**How.** The Git tab commit box (Cmd+Enter); the "Commit and push" and "Amend last commit" menus; "Commit without formatting" after a step refusal. The `commit_checkout` operation.

**Behaviour.**
- The message leaves whole, as written: the server appends nothing — no trailers, no tasks.
- Commit steps run over the index version; hooks run in the commit tree. The operator's commit lands without judgement: after landing it's judged against the parents, and every missed violation is recorded as the operator's escape. A rule whose inspection failed on the commit doesn't hold up the other rules' records: the next measurement of that rule will record its violations, without a holder. The same `commit_checkout` from a thread is judged like a landing (A4): a gated-rule violation refuses.
- Amend replaces the commit under HEAD, keeping its author and date, after confirmation: already pushed will diverge.
- The commit finishes a running merge, cherry-pick, or revert like `git commit`; during rebase it adds a commit.
- The branch moves only from the HEAD the commit was built on; index writes rearranged meanwhile stay and are named.

**Limits.** Amend inside merge, cherry-pick, or revert, and a commit during am refuse. The agent doesn't get this door as a tool: they commit with `submit_work`.
