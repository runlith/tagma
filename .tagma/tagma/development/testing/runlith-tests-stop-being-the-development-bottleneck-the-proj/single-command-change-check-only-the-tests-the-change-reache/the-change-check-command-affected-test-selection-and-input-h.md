---
id: 01a16bcd-b83e-7c69-becc-2c961b003a60
title: "The change-check command: affected-test selection and input-hash result cache, Validation in AGENTS.md"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16bce-ade4-7236-ae1f-8ef8db674dee",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b70405af9265
---
The `bun run check:change` command and Validation landed in `c666d64344`, generated imports fixed in `a1b20697d0`, the unit/resource boundary clarified in `678ef48709`; the report's public types and the lockfile go into `1ca6051857`. Five contract tests and typecheck green; an exact rerun of a checked file used the cache, Bun and Vitest checked one file each. The `--changed` probe — [[fd75347c|with observation bounds]], the sample and the shared-quiet-window commands — [[2809e291|with the remaining 20× measurement]]; the wall/CPU comparison deferred by the lead's order.
