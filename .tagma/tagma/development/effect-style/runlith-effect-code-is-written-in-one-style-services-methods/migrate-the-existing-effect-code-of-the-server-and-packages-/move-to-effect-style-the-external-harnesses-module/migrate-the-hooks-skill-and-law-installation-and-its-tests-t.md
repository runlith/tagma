---
id: 01a13f24-baf3-7b19-bbba-ad8da2d1ee1b
title: Migrate the hooks, skill and law installation and its tests to Effect shape
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f16-3817-7139-a4eb-84cd102afa14",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f16-1128-7f09-9a38-ea1d23d2ccf0
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/installs
---
Migrated the `external-harnesses/installs/` group with its direct consumers: Effect.fn/fnUntraced, FileSystem and effect-test with scoped resources; the read_installation_status span kept. Group production 1422→1405 nonempty lines, effect-style 21→0. Parts delivered in 3bd750c73c and b4c3017270; two independent reviews held, both confirmed findings fixed, CLAUDE_CONFIG_DIR isolation verified red→green. Part checks: 35 tests / 166 assertions and 27 tests / 208 assertions; check_law — 17 rules, 0 violations. The final shared tree's fully green typing is unproven: the last server check showed 13 external errors in changesFeed.itest.ts, threads/placement.itest.ts and threads/birth/placement.test.ts, none from this delivery. Host-bundle system tests were not run under the operator's restriction.
