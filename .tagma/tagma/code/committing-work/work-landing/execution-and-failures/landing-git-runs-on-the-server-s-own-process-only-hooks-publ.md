---
id: 01a1542f-7bf5-7a61-8e9f-abff11609ccf
title: Landing git runs on the server's own process; only hooks, publication update-ref and merge --quit go through the execution host
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a15417-b33a-7058-b932-71f4380e8c1a
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/servingGit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/commit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/hooks.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/place.ts
    symbol: landingPlace
---
`landingPlace` hands landing two gits: `git` — the server's own git, and `hosted` — the one `ServingGit` issued, where every call passes execution-host admission as the thread's command. Only acts that run repository code or change the checkout at landing's request go through `hosted`: `git hook run` of every commit hook, the publication `update-ref`, and `merge --quit` on merge close. Such a process shows in the thread's commands, command rules apply to it, and an admission refusal arrives as `git-not-admitted`. Everything else — reads, tree assembly in the private index, object writes, the commit tree and the checkout's index pull — goes through `git`: admission per call (target resolution, store writes, host roundtrip) would cost more than the git itself, and it buys these calls nothing.

The checkout's index pull (`reset --pathspec-from-file=-`) also changes the checkout but carries its own stdin, and the host has no act to pass bytes into input. So it goes through `git`, like any `hosted` call with stdin or binary output.

Cancelling landing is identical on both roads: an interrupted direct git takes its process group with it. What user settings git sees ([[fbdff675]]) is set by the environment that `runGit`, `actingGit` and `configuredGit` lay before the road choice. Commit steps go on neither git but through `ProgramRoad`. commit_checkout, pull and merge_worktree have no `ServingGit`: they pass the server's one git into both roles.
