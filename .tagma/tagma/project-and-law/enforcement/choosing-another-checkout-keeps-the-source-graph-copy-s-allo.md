---
id: 01a16175-d657-7764-892a-baf1cbfca4dd
title: Choosing another checkout keeps the source graph copy's allowed block ids
ord: 100
tags: ["reflection"]
fields:
  {
    "actual": "409 not-found 'that block does not exist' in 101 ms: subjectOf cached Target with main row.id in ResolvedNames, factsAt picked the worktree, scoped used that row.id through the new graph Blocks.",
    "command": "bun test --parallel=1 ./src/composition/testing/enforcement/absorbCheckout.stest.ts (cwd=/opt/workspaces/runlith/apps/tagma/server); enforce_rule with a worktree checkout and a main-copy rule blockId",
    "expected": "After choosing the worktree, rule and owner names resolve in its graph copy; numeric ids from the main copy are not used in the worktree."
  }
---
Filed from project `runlith`.

In the public test check_rules and submit_work already read the rule in the worktree; enforce_rule with checkout and place: selectCheckout reaches a foreign numeric id. invocation.contextAt creates the crossingCall before operationFacts but keeps it after the served graph switch. The name-resolution cache scope does not survive the graph-copy switch.
