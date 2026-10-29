---
id: 01a14c13-c481-7acc-8aa6-03cd5dfdb32c
title: A worktree branch is pushed and gets a GitHub pull request in a single act
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: dir
    ref: packages/github
  - kind: file
    ref: apps/tagma/server/src/landing/merge/pullRequest.ts
---
**Value.** Work that needs the team's review reaches GitHub review without a terminal.

**How.** The PR in the thread panel's finish strip and "Open a pull request" in the board row menu; the `open_worktree_pr` operation via the GitHub CLI.

**Behaviour.**
- The branch is pushed to the remote a publish would go to, with upstream, then `gh pr create` runs in the worktree; the title and body come from the commits unless given.
- An already open PR is returned instead of a second one; the answer counts the paths whose uncommitted lines the PR does not carry.
- The link to the open PR stands in the menu and the strip until the window reloads.

**Limits.** Without an installed `gh` or without a remote it refuses before pushing. A push that landed stays even if `gh` then fails.
