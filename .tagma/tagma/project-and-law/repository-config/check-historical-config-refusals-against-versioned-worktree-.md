---
id: 01a1941f-f2bb-77f3-9717-654f734e99df
title: Check historical config refusals against versioned worktree landing
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd90-73db-9615-87709cf48f50",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a129b7-c935-7286-8792-25ff56e7305b
  - kind: relates
    to: 01a13609-6c2c-72c0-b9dd-139b0e651b57
---
Investigate the historical EOF and missing-programs refusals against current versioned config reads; preserve configuration and inspection policy. The original EOF on 2026-10-11 concerned tracked `lode.jsonc`, not TypeScript: its complete eight-line JSON and clean subsequent diff survive, but the refused reader's input bytes, built tree and running implementation do not. The missing-programs refusal on 2026-10-13 survives alongside a 1 ms successful `check_law` over base `5d1bda407c` and retry commit `357a865261`; the original resolved programs declaration, checker launch/cwd and rejected tree were not retained. Those original commit objects are unavailable in either present repository, so neither historical producer is established and both reflections remain unanswered.

Current `CommitShape.shape` reads `Configs.read` from the selected commit tree; config files and imports come from raw git objects, and the cache checks imported blob identities. The native `versionedConfig.itest.ts` scenario warms the main config cache, moves a thread into a worktree with a different imported formatter, then leaves both working configs empty and the worktree import incomplete. A source-only `submit_work` lands the worktree's tracked formatted value, preserves the incomplete working bytes and leaves main HEAD unchanged. This is a current consistency check, not a red/green fix of either historical refusal. No repository config, programs declaration, check, format step or runtime policy changed.
