---
id: 01a13535-bb67-7741-9de8-5182064d4461
title: Landing, commit_checkout and pull read a git checkout's layout once per act, and HEAD, the branch and the unfinished operation on every check
ord: 12
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a132fb-f271-71b6-a5fa-df0c27cfd1e3
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/git/places.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/batch.ts
    symbol: publishToCheckout
  - kind: symbol
    ref: apps/tagma/server/src/platform/git/publish.ts
    symbol: publish
  - kind: symbol
    ref: packages/git/src/repository.ts
    symbol: standingAt
---
Where a checkout's git dir, index, hooks and unfinished-operation files (`MERGE_HEAD`, `rebase-merge`…) live is the layout; it does not change over one act. Landing (submit_work), commit_checkout and pull read it at the act's start with one `rev-parse` together with HEAD (`standingOf` → `standingAt` in `@runlith/git`) and pass it onward as a `GitPlaces` value: the commit tree, hooks, index pull-up and the publication compare-and-set never ask git about it again. Every extra question would have cost another git process. One batch publication takes the same layout from the first unfinished-operation check and passes it into the CAS and settlement: re-reading paths makes those state checks no fresher. A new attempt and a separate index-debt payment read the layout anew. A merge worktree still reads it in several places of its act — each read one process, through the same `placesOf`. check_rules and enforce_rule over the change take the common dir from the layout read when the change was assembled, while enforce_rule and read_enforcement read HEAD, the common dir and the measurement shelf with one `rev-parse` (`placeOf` in enforcement): otherwise every config read would ask git where `<common dir>/tagma/config.json` lives, and every measurement read or write where the shelf is.

The layout and HEAD are derived by the kit (`layoutAt`, `standingAt`, `headAt` in `packages/git/src/repository.ts`); platform only names operation paths and translates the refusal into `OwnGitFailed`. `indexPath` takes the index path from the same layout, so every index writer's `git-index-writes` lane key comes from one producer.

State that moves under the act is not layout and re-reads on every check: whether an operation runs — by its file's presence at the known path (`operationIn`, no git), HEAD and the branch — with `pointedAt` before the publication compare-and-set, HEAD after the judgement — with a separate `rev-parse`. The layout cannot outlive the act: a worktree may be recreated at the same path with a different git dir, and `core.hooksPath` may change; inside an act nothing catches such a swap.

The `rev-parse` answer parses by exact row count: a path with a newline (a checkout directory, `core.hooksPath`) yields a different count, and then every path reads in a separate run whole. On an unborn branch `rev-parse HEAD` refuses, and layout, branch and commit absence read separately. A detached HEAD answers the branch as null, and landing refuses `no-branch`.
