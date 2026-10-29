---
id: 01a14c13-c481-7acc-8aa6-03bccc335a96
title: The project declares a checkout shared or single, and the shared-tree law and the question about sweeping git commands depend on it
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b854ec4a27
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03bbcfdb998e
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/doctrine/theSharedCheckout.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/doctrine/branchesAndWorktrees.ts
  - kind: file
    ref: packages/agent-tools/src/bash/preflight.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/settings.ts
    symbol: checkoutMode
---
**Value.** In a shared checkout where several agents and the operator write, agents are taught not to touch others' and asked about sweeping commands; a lone writer doesn't need this.

**How.** The `agent.checkout` setting: `shared` (default) or `single`; the value comes from the project owning the place's checkout.

**Behaviour.**
- `shared` puts sections into instructions about working in a shared tree (no stash, reset, or clean under others' work; a question only on a genuine edit conflict) and about branches and worktrees (don't switch the main checkout; work on another branch goes in its own worktree); the Commits section explains that landing takes only its own lines.
- In `shared`, a tree-sweeping shell command (`git stash`, `git checkout .`, `reset --hard`, `clean`, and the like) raises the operator's question in review mode.
- `single` doesn't give these sections, and the Commits section says `submit_work` takes the whole tree.

**Limits.** Divergences from product texts: the `shared` description promises sweeping commands refuse, while the code only asks the operator in review and lets them through without asking in trust and bypass; the `single` description promises nothing refuses, while the shell refuses an in-place file-rewriting command (`sed -i` and the like) even there; the `single` instruction says `submit_work` takes the whole tree, while the server doesn't read the mode and lands by line accounting, as in `shared`.
