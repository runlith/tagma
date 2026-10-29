---
id: 01a15734-38ce-7cec-99f4-18adec5ad758
title: Someone else's app file move is credited to the session whose commands only ran server tests
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "read_changes lists 4 app paths (places/ThreadPanes.svelte.ts, places/standing.ts, worktrees/ThreadPanes.svelte.ts, worktrees/standing.ts) as this session's held lines, run 01a156e6; submit_work reports them in `left` as this session's uncommitted lines",
    "command": "read_changes (bare) after bash `bun test --parallel=2 …itest.ts` in apps/tagma/server while another session moved apps/tagma/app/src/lib/features/executions/places/* → worktrees/*",
    "expected": "The moved app files are held by the session that moved them, or listed as unattributed observations of my command window"
  }
---
Filed from project `runlith`.

Session 01a1565c-47b9-7ff2-bfd3-246b13adade8 touched apps/tagma/app with no file tool; its commands only ran `bun test` and `bun run typecheck` in apps/tagma/server. The neighboring 39 paths of the same move correctly went to unattributed, while these four went to this session's held lines. Consequence: the commit's `paths` had to list 82 paths by hand, because `paths: ["apps/tagma/server"]` captures others' paths, and a call without paths would have carried away another's move.
