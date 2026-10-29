---
id: 01a0daa5-8928-7d54-a212-5605420a1551
title: Declare `enforcement.programs = "checks"` for runlith and move the layer runner and its contract test into `checks/`
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de0b-e6ab-7936-871e-6bc654696615",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0da9e-879c-73fc-8ddc-d74a833122ed
---
Per [[833122ed]], the runlith half; the setting, its reading and the `rules` prompt landed in `0601d82c9d` ([[094206dc]]).

- **The setting.** `write_setting { key: "enforcement.programs", value: "checks" }` in runlith, on a server built at or after `0601d82c9d`, which knows the key. Writing a setting asks the reader under trust, so a spawned agent is refused `unattended`; the call is made from a thread the operator reads.
- **The move.** Owned by the tests thread (01a0d4d0-809b-73d1-bd6d-9a4b7dcfb6c4), asked on 2026-09-25: `scripts/testLayer.ts` and `test/testLayer.itest.ts` into `checks/`, the runner path in `apps/tagma/server/src/enforcement/testLayerContract.itest.ts`, `reanchor_path` for the claims over the runner, and any enforced rule whose program argv names the old path. `test/layers.ts` stays.

Done when `read_inspections` in runlith answers `checks` and the layer runner's contract test passes from `checks/`. Then close [[833122ed]] into [[039d7121]] and [[14725e18]].