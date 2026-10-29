---
id: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
title: Checkouts
ord: 12
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "store/tables.ts"
      },
      {
        "at": "roots/coverage.ts"
      },
      {
        "at": "store/coverage.ts"
      },
      {
        "at": "roots/bindings.ts"
      },
      {
        "at": "contract/wire/assignments.ts"
      },
      {
        "at": "contract/wire/history.ts"
      },
      {
        "at": "contract/wire/checkout.ts"
      },
      {
        "at": "contract/wire/environments.ts"
      },
      {
        "at": "contract/wire/checkoutActs.ts"
      },
      {
        "at": "contract/wire/checkoutReads.ts"
      },
      {
        "at": "contract/wire/coverage.ts"
      },
      {
        "at": "contract/wire/repositories.ts"
      },
      {
        "at": "contract/wire/roots.ts"
      },
      {
        "at": "checkouts/feed.ts"
      },
      {
        "at": "assignments/membership.ts"
      },
      {
        "at": "store/assignments.ts"
      },
      {
        "at": "checkouts/gitWrites.ts"
      },
      {
        "at": "checkouts/rows.ts"
      },
      {
        "at": "roots/registry.ts"
      },
      {
        "at": "store/rootRegistry.ts"
      },
      {
        "at": "repositories/pushName.ts"
      },
      {
        "at": "repositories/registry.ts"
      },
      {
        "at": "store/repositories.ts"
      },
      {
        "at": "roots/healing.ts"
      },
      {
        "at": "roots/uses.ts"
      },
      {
        "at": "store/uses.ts"
      },
      {
        "at": "watch/tree.ts"
      },
      {
        "at": "roots/proof.ts"
      },
      {
        "at": "."
      },
      {
        "at": "testing/",
        "role": "testing"
      },
      {
        "at": "environments/access.ts"
      },
      {
        "at": "environments/failure.ts"
      },
      {
        "at": "environments/backends.ts"
      },
      {
        "at": "store/environments.ts"
      },
      {
        "at": "environments/uses.ts"
      },
      {
        "at": "store/environmentUses.ts"
      },
      {
        "at": "checkouts/reads.ts"
      },
      {
        "at": "repositories/listing.ts"
      },
      {
        "at": "checkouts/ignoredCopy.ts"
      }
    ],
    "id": "workspace",
    "kind": "substrate",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c703-263a-7a49-8a3d-0bfdc70821a1
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: imports
    to: 01a0d564-ec47-7645-8756-ec405e1647fa
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-beef-70cb-81c5-89e59e75d459
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
sources:
  - kind: dir
    ref: apps/tagma/server/src/workspace
---
Agents and the operator work in checkouts of git stores, and the module knows these places: registered stores and file roots, checkout state, which roots a thread occupies, execution environments, git acts over a checkout — stage, unstage, discard, fetch, push, abort, and pull up to the merge commit — and the commit tree: the checkout's private working tree where Tagma commit hooks run. It leaves worktree creation and completion, commits (landing, commit_checkout, the pull merge commit), and line authorship to worktrees, landing, and the change record.
