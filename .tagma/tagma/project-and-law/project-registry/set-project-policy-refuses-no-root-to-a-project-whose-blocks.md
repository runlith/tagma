---
id: 01a179a5-ea6f-75ab-baee-03108168fde4
title: set_project_policy refuses no-root to a project whose blocks are served from files
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "refused[no-root]: project 5 has no root block — though root 4d2ff254 stands, list_root_blocks answers it",
    "command": "set_project_policy {ref: \"runlith\", field: \"private\", value: true}",
    "expected": "Project 5's private policy on, act recorded"
  }
---
Filed from project `runlith`.

`ProjectPolicy.set` (`graph/serving/policy.ts:106`) writes a `project_set` act on the project root, which it finds with `blockRows.rootBlockOf(current.id)` in the machine graph's store: `machineGraphOf` performs the set within the machine context. For a project with `servesFrom: files` (project 5, team) the blocks and root live in its own store, so the lookup fails in the machine's. `setStorage` and `setRemote` of the same service write acts with a `null` block and do not fail. The same path calls `set_project_storage` into team mode for a private project (`registry.ts:192`), so it would have refused too. Likely root: recording the act on a root from a foreign store; fix: act without a block, like setStorage. Server build 20261026T185929318Z.
