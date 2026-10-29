---
id: 01a11d62-ac28-7266-ba27-5e2d2c4f1d57
title: "Lines leave as checkout-gone only once the checkout is deleted: registration is over or git no longer administers the worktree; a missing directory on its own is a possible move"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/driver.ts
  - kind: symbol
    ref: apps/tagma/server/src/workspace/roots/registry.ts
    symbol: RootRegistry.removed
---
Lines leave as `checkout-gone` only once the checkout is deleted: registration is over, or git no longer administers the worktree; a missing directory on its own is a possible move.

Lines leave `checkout-gone` two ways: Tagma archiving the worktree itself, and the line-exit driver. The driver revokes a checkout's lines whose root no longer reads only once the root registry (`FileRoots.removed`) names it removed:
- no registration, finished (`retired`), or superseded (`replaced`): this `rootId` will never read again;
- the directory is gone, and so is the worktree's git-administration directory outside it (`.git/worktrees/<name>`): what `git worktree remove` and `prune` done outside Tagma look like.

A missing directory on its own is no deletion. A renamed or moved checkout (`git worktree move`, `mv`) keeps administration, and the registry later finds it by witness under the same `rootId`. Revoking its lines on one missing directory would hand live work to strangers or nobody. The main checkout keeps `.git` inside itself, so its disappearance always reads as a possible move.

Without this, a worktree deleted outside held its lines forever: the registry's healing never stands down a root with lines on it, and lines never left while the root stood.

Revoking (`vacate`) also removes everything the change record held about the checkout: step debts, released-line witnesses, landing facts, the last seen HEAD. The root is free after, and healing stands it down.

The signal arrives as a HEAD shift: observation reports `head: null` once a previously read HEAD stops reading. A server start and any driver pass over the checkout trigger the same pass.
