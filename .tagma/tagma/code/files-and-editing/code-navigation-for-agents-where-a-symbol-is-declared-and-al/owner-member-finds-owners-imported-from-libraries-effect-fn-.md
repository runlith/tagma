---
id: 01a165ab-b9dc-755f-a901-7f9ac195d7ed
title: "`Owner.member` finds owners imported from libraries: `Effect.fn`, `Schema.Struct`"
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a165ac-177d-793d-b8a6-b9cad1cca90b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
sources:
  - kind: file
    ref: packages/navigation/src/owners.ts
---
`uses {"name":"Effect.fn"}` on runlith refuses with `symbol-missing: no symbol fn stands as a member of Effect in packages/tagma/src/rules/effect.ts` and takes 1.7–5 s. `packages/navigation/src/owners.ts` looks for `Owner.member` owners only among declarations in repository files; `Effect` from the `effect` package, imported in thousands of files, is not found, and the single local `Effect` is picked up. For Effect code this is the most frequent question: `Effect.fn`, `Schema.Struct`, `Stream.runForEach`, `Layer.effect`.

Goal: `Owner.member` finds owners imported from libraries alongside those declared in the repository; same-named owners get one answer each or a refusal with a list, as now. Refusal and answer for a frequent owner name take no longer than a regular question.

A second finding of the same measurement: the answer warned `stale: .opencode/plugins/tagma/package.json changed after the snapshot` — a `package.json` in a folder no program reads. The warning should stand only where the changed file can affect verdicts.
