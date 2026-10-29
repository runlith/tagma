---
id: 01a13b66-8f84-73ef-8771-3c13cbfa641e
title: "The effect-style check holds the recorded Effect style at commit time: the syntactic shapes it forbids"
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13ad9-62d0-709e-8021-29b44a8e3ed8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
sources:
  - kind: dir
    ref: checks/law
---
The recorded Effect style (the `effect4` skill's "How Effect code is written here" section, `.agents/skills/effect4/SKILL.md`) is held by a commit-time check; otherwise 10–20 agents multiply the old shapes faster than they are migrated.

Build the `effect-style` law check in `checks/law/effect-style/` after the `swallowed-failures` pattern (declaration, implementation, sites; registration in `checks/law/checks.ts`). Parameters select shapes so several rules can judge different groups with one check. Shapes are syntactic only, no types:
- `self-alias` — `const self = this`;
- `self-binding` — `{ self: … }` in `Effect.gen(…)` and `Effect.fn(…)(…)`;
- `service-class` — a class implementing `Context.Service.Shape<…>` or `X['Service']`;
- `gen-wrapper` — a function, method or arrow whose body is only `return Effect.gen(…)` (or an expression arrow `=> Effect.gen(…)`);
- `pipe-after-fn` — `.pipe(` right on the result of `Effect.fn(…)(…)` / `Effect.fnUntraced(…)`;
- `throw-in-effect` and `sync-decode-in-effect` — `throw` and `Schema.decode*Sync` directly in the generator passed to `Effect.gen`/`Effect.fn`/`Effect.fnUntraced` (not in a nested plain function);
- `scope-run-sync` — `Effect.runSync(Scope.make(…))`;
- `schema-tagged-error` — a class extending `Schema.TaggedError`;
- `test-runner` — in a test file (`*.test.ts`, `*.itest.ts`, `*.stest.ts`), a call to `Effect.runPromise*`, `Effect.runSync*` or `ManagedRuntime.make`.
The violation fingerprint is stable against edits outside the site (file, nearest declaration, shape, hash of the site's normalized text — as in `swallowed-failures`).

Proof is the check's fixture tests: each shape is found and does not fire on a permitted neighbour (e.g. `Effect.gen` inside an `Effect.fn` body, `throw` in a nested plain function); and a repository measurement — violation counts by shape and module, which the lead records as debt through `enforce_law`.
