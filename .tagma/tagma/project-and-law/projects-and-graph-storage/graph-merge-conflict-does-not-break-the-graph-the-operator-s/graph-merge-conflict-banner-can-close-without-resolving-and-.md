---
id: 01a17805-0b02-74e3-9c10-715ff5d6a8b2
title: Graph-merge conflict banner can close without resolving, and opens again from the project conflict list
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
The "Graph changes could not be merged" banner has only "Assign to agent" — it cannot be closed, it hangs over the project window until the conflict is taken apart. An operator who is not ready to take the conflict apart now sees it all the time.

The idea: let the banner close without losing the conflict. A closed conflict does not vanish: it stays in the project's unresolved-conflict list, from where it can be opened, its files viewed, and analysis assigned. The banner may return later — on a new conflict or as a reminder. Plain "close and forget" is refused: knowledge-branch conflict must not vanish silently.

Unclear: when the banner returns and whether it returns at all; where the list lives (project screen, branches section, or worktrees); how "other merges wait for restore" counts in it.
