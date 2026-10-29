---
id: 01a13b49-8b56-7bb2-a992-457638898737
title: In the worktree graph another session's main task is listed under my session, and submit_work appends its id to my commits
ord: 22
tags: ["reflection"]
fields:
  {
    "actual": "Both commits got '(9cb18e35, 18dd8c50)': 9cb18e35 is another session's task on main (in_work since before the worktree was cut), while in the worktree graph its holder shows as ba9005eb — my session; prime also shows '9cb18e35 … — ba9005eb'. Cost: two commits on branches d57b96674f and 61b984089d carry someone else's task id.",
    "command": "submit_work (worktree tagma-calls-echo, session 01a13b15-…-ba9005eb, only 18dd8c50 claimed)",
    "expected": "Only tasks this session holds land in the commit subject: (18dd8c50)"
  }
---
Filed from project `runlith`.

It looks like the holder in the worktree graph copy is stored as a session number that resolves to a different session in the worktree graph than in main. This session never claimed task 9cb18e35 (claim_block ran only for 18dd8c50 via create_block claim: true). Check: read_block 9cb18e35 in the worktree — "held by a session"; prime worktree — "9cb18e35 … — ba9005eb", "18dd8c50 … — ba9005eb".
