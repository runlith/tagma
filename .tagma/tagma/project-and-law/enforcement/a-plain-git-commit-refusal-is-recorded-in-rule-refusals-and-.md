---
id: 01a1616d-ba20-718f-af43-b038281d9e40
title: A plain `git commit` refusal is recorded in rule refusals and shows in "Commits blocked"
ord: 68
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16169-1dc4-71d5-9d99-101d6d64b38e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16160-60b0-7b2c-9a16-36d6e8ce86ef
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-63363d3e5239
---
The commit gate (`tagma check` from hooks) judges the index via `check_rules over: staged`, but `ruleChecks.before` for `git_commit` skipped writing the refusal, and the rule page didn't show that a human or agent had hit the rule ([[e8ce86ef]]). A refusal that stops a commit — always a session commit, an operator commit without `TAGMA_ALLOW=1` — is written with the same `kept` as submit_work/merge_worktree refusals, with act `git_commit`, caller, branch and base; a commit the operator lets through isn't recorded as a refusal (it becomes an escape after landing). A trial `check_rules over: staged` still writes nothing.
