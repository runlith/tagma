---
id: 01a185bb-fbfa-7a6b-bde8-4c8b45b4288b
title: load_skill keeps a skill's reference list from thread start while serving its current body
ord: 66
tags: ["reflection"]
fields:
  {
    "actual": "Refused \"Agent skill tests has no reference ios, stands: its references are measuring.\"; the same skill loaded without references returns the edited body, so the body is current and the reference list is stale",
    "command": "load_skill {skill: \"tests\", references: [\"ios\", \"stands\"]} after creating .agents/skills/tests/references/ios.md and stands.md in the thread's worktree",
    "expected": "The references load with the body, as the files now on disk declare them"
  }
---
Filed from project `tagma`.

Both files exist under the skill's `location` (`~/.tagma-dev/worktrees/tagma/feed-e2e/.agents/skills/tests/references/`), each with a `# heading` first line like `measuring.md`. The workspace note's catalog line still lists only `refs: measuring`. Workaround: read the reference files by path. At the thread's next turn the catalog refreshed ("The available skills have changed") and the same call returned both references, so the staleness lasts until the turn ends: an agent creating a reference cannot check it in the same turn. Possibly related to the open task 24e6b6b0 on the stale load_skill catalog.