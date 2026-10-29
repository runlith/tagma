---
id: 01a1559e-ac45-73fb-afb6-aae6bacd7de5
title: "A new repository's team graph with no commits is never committed: sync_graph refuses with graph-commit"
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "refused[graph-commit]: git graph-base: fatal: Needed a single revision; .tagma stands untracked, and graph.commit=auto autocommit does not do it either",
    "command": "add_project(name=\"law-lab\", rootPath=\"/opt/workspaces/law-lab\", storage=\"team\") in a fresh `git init -b main`, then sync_graph(project=\"law-lab\")",
    "expected": "Registration or the graph's first commit creates the branch root commit with the .tagma tree"
  }
---
The graph commit looks for its base through HEAD, and on an unborn branch there is none. The refusal's way out ("read what git said") never names that the repository needs its first commit. The workaround is one ordinary code commit before the first graph commit.
