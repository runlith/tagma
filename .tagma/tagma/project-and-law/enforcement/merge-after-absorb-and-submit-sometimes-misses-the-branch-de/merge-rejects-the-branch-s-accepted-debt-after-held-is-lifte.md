---
id: 01a16496-0cd2-77a7-9a80-8300cf7839ff
title: Merge rejects the branch's accepted debt after held is lifted
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Deterministic run, 26.10 s: native enforce/create/absorb/submit succeed; merge refused rule-violated on shared.ts -> ./value. Git show of the rule module card at HEAD worktree confirms debt=[{fingerprint:'shared.ts -> ./value',owner:'d9ef2827'}] with no held; escaped=[].",
    "command": "bun test --parallel=1 ./src/composition/testing/enforcement/absorbCheckout.stest.ts (cwd=/opt/workspaces/runlith/apps/tagma/server), after submit — enforce_rule without absorb on HEAD worktree, sync_graph, merge_worktree",
    "expected": "Ordinary debt accepted into the worktree graph and standing at the source tip carries over with merge as debt; the held-to-ordinary transition does not make this violation new."
  }
---
Filed from project `runlith`.

This ties the refusal to the held→ordinary transition, not to a read delay: before merge the public enforce_rule measures the branch's already-committed code and stores ordinary debt. Diagnostic reads ran only after the refusal. The accepted debt source check is investigated by task d99f29de.
