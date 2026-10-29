---
id: 01a187c8-a466-7ad5-b655-2d4c62d65316
title: set_project_storage to team leaves the moved tree uncommitted until sync_graph
ord: 250
tags: ["reflection"]
fields:
  {
    "actual": ".tagma/ (5747 files) stayed untracked (`?? .tagma/`) 35 s after the move; only an explicit sync_graph committed it (09dee3c4f0)",
    "command": "set_project_storage {ref: \"tagma\", mode: \"team\"} with graph.commit = auto",
    "expected": "The move lands the whole tree in .tagma and the automatic graph commit takes it: the first team commit carries the tree without another call"
  }
---
Filed from project `tagma`.

The commit cycle wakes on graph writes; the storage move writes the tree without waking it, so a project with no further graph activity keeps its whole graph uncommitted indefinitely.