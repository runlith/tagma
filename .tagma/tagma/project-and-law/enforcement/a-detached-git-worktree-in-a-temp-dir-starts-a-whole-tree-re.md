---
id: 01a16f2e-d69c-77f2-a5ea-b3d063cc7c2c
title: A detached git worktree in a temp dir starts a whole-tree re-measure of enforced rules, loading ~5 cores
ord: 135
tags: ["reflection"]
fields:
  {
    "actual": "The server started a background task \"Re-measuring an enforced rule — Rule ea465bed\": git grep across the whole new tree, 45% CPU of the entire 12-core machine (read_machine_load, 20:31 local), load average rose from 3.7 to 14 and ruined the quiet measurement.",
    "command": "git worktree add --detach /var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/quiet-bb651bcff2 HEAD (from main of runlith), then bun install --frozen-lockfile",
    "expected": "An external detached worktree for measurement causes no background server work: nobody changed rules in it; debt and escapes belong to main."
  }
---
Filed from project `runlith`.

The worktree was created with `git worktree add`; Tagma did not create it (the `external` line in list_worktrees). The tree holds no changes against main HEAD, so re-measuring cannot yield new knowledge. Process: pid 80730 `git -C …/quiet-bb651bcff2 -c core.quotePath=false grep -l -z -F -w -e catch -e catchEager …`.
