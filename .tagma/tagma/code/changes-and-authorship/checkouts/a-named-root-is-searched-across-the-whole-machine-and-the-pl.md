---
id: 01a1318c-8979-71d8-afe3-2a452086e7fd
title: A named root is searched across the whole machine, and the place carries the checkout's own project
ord: 9
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/paths.ts
    symbol: makeCheckoutPathService
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/reads.ts
    symbol: makeGitCheckoutReads
---
`CheckoutPlaces.placeOf/rootOf` looks a named `root` (root id or absolute path) up first in the calling project's coverage, then in the whole-machine root index (`CheckoutPaths.rootAcross`). The found `ProjectRoot` carries the checkout's own project; the calling project decides only the default with no `root` and the choice among projects sharing one checkout. A checkout shared by two other projects refuses with `root-inconclusive`.

- The consumer takes the project from the found place, not from the call: line accounting (`Intake`, the commit overlay `pathsOf`) filters by the place's project, and the calling project would hand another checkout's lines to the wrong accounting or an empty answer.
- `CheckoutAt` carries the place's project: `commit_checkout` and `pull_checkout` are judged by the checkout project's rules and commit steps and move lines into its accounting, while holder and act come from the calling project.
- The shared id and path search use one machine-coverage snapshot and one `onCovered` invalidation. A project whose coverage cannot be read — its main checkout gone, its store moved or no longer opening — does not enter the index: a path under its root or under the roots the index last knew it by, and a directory overlapping them, refuse with that project's own failure, its ids answer `not-found`, and every other project keeps its places. One broken project never refuses another's paths.
- `CheckoutPaths.rootAcross` first looks the exact root id or physical address up in the preferred project's snapshot. A nested path does not prove membership: it can hold a standalone repository of another project. A confirmed root needs no whole-machine index, while a miss consults it and keeps a typed refusal. A registry switch reconciles project addresses; its own snapshot resets on an address change or `onCovered`. So a warm search reuses indexes without rereading and recanonicalizing every root.
- A named root's path is canonicalized whole, link at the end included: a root is a resource, not a directory record. Path search (`atSpelling`) follows a moved root (`followAcross`) at most once: it answers `true` for a root that moved nowhere too, and without that limit a link-spelled path would spin forever.
- `thread.changes` returns each checkout's and commit's `projectId` through the same `rootAcross`; `null` means the project is undetermined, and the side is then `stale` with a reason.
