---
id: 01a158da-47a7-7769-8dcd-765a8da1a783
title: "Installed build refused every landing with `Missing key at [\"default\"]`: SDK doors are files beside the bundle, not text imports"
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a156c5-bb98-7bca-8680-5002e174fd5d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a156ec-eded-78fd-a9ab-b0d145445f10
---
In the installed build, every landing refused `Missing key at ["default"]`: in the server bundle, `Bun.build` glued the config profile's `import('@runlith/tagma/rules', { with: { type: 'text' } })` together with the code import of the same file (`forms.ts`, `runner.ts`, `format.ts`), and the profile received a namespace with no `default`. `orDie` turned that into a defect with no code, so every `submit_work` and `check_rules` in runlith failed.

Fix: the doors are named `new URL('./rules.ts' | './effect.ts', import.meta.url)` in `@runlith/tagma/sources`, cut collects them beside the bundle like `evaluate.ts`, and the profile reads them through FileSystem. An unreadable profile file yields the `config-unrunnable` refusal with a path.

Proof is `config/bundled.itest.ts`: a minified bundle of a fixture that loads the doors both as code reads `tagma.config.ts` from a commit. With the old profile the test fails with the same `Missing key`. The `20261020T102615508Z` install build carries `rules.ts` and `effect.ts` beside `http.js`. After the restart the module cards are due: `config` gets a `testing/` entry with testing role and imports-tests on [[520698f4]], `@runlith/tagma` gets an `src/rules/sources.ts` entry for `config`. Then `submit_work`.
