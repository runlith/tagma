---
id: 01a13b97-1cdf-73e3-a6d5-0c7eca6a3e9f
title: "Reference: the remote/ module in Effect style and samples in the effect4 skill"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13b96-0fdd-7eab-9f4e-991d3a87139c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13b76-3d46-78eb-b352-1c34449dfe0d
sources:
  - kind: dir
    ref: apps/tagma/server/src/remote
  - kind: file
    ref: .agents/skills/effect4/SKILL.md
---
Migrate all of `apps/tagma/server/src/remote/` — production code and tests — to the `effect4` skill's "How Effect code is written here" section shape: services as closures in `make` + `X.of`, tag members and costly steps as named spans per the "Spans are the performance telemetry" section, cheap helpers as `Effect.fnUntraced`, `Data.TaggedError` errors with projection at the boundary, tests on `@runlith/effect-test`. Behaviour does not change; only telemetry changes — the module gains spans it never had. The module becomes the reference agents copy; short samples from it join the skill (a boundary error, a test with a double under a tag, a stream with replay) plus a line about the reference module.

Done when: the effect-style rules (8fcfef49, df923180, bc8f1e15, 373e29e4, 01ba3d55, d270a238) and swallowed-failures find nothing in the module, `bun run typecheck` is clean, the module tests and `composition/testing/remote/door.itest.ts` are green, the model-rule review passed.
