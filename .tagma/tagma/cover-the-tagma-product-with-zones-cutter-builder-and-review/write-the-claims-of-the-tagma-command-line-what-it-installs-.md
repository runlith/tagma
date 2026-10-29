---
id: 01a0ca97-13ee-7db5-9520-9d7f4c684fe0
title: Write the claims of the `tagma` command line, what it installs, and what an installation is
ord: 216
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cacf-7306-722b-a984-fd77196c6b73",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/cli
  - kind: dir
    ref: apps/tagma/server/src/install
  - kind: dir
    ref: apps/tagma/server/src/skill
---
Read `cli/`, `skill/` and `install/` whole, with `installationPaths.ts`.

Write the claims of [[03de79f4]], [[6e948fd9]] and [[c0f69bd1]]: what the command surface is generated from, what `tagma op` guarantees is the same act an agent's tool runs, what a hook's arrival proves about the session it names, what installing into a foreign CLI writes into somebody else's configuration and what it refuses to touch, what a release's closure contains, and what a failed release leaves. Note in your reading that `install/` stands on no floor of this package's direction table — the module claim [[05042d40]] states that; do not restate it, but let it inform what you check.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].