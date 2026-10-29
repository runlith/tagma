---
id: 01a156d9-a73e-7045-bbfd-b08a47447c6b
title: "`read_inspections` answers in one line per function and by name — signature with exits, limits on request"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a15653-a6a0-7f9b-978d-5f88be3f8cf7
sources:
  - kind: file
    ref: apps/tagma/inspection/src/core/catalog.ts
---
`read_inspections` answers briefly and by name: the list is one line per SDK function; by name — signature, violation unit and exits; limits only on request. An agent gets an inspection's shape from the `@runlith/tagma/rules` types, and the catalog serves whoever has no types at hand. Part of [[b6f7a4e0]].

## What stands now

`read_inspections` answers every builtin whole in one answer — the pack, reach, full parameter schema, fingerprint unit, every `limitations`, refusal words — plus the used packs, the `enforcement.programs` catalog, and each enforced rule's document. The [[be3f8cf7]] measurement: 51.5K characters of JSON over 8 builtins, about 25K as text. The page is 19 builtins (`INSPECTIONS`), everything at once.

## What will be

Input: `project`, `limit`, `cursor`, `map` — as now; new — `name`, `key` and `limitations`. Name and key are separate fields because the migration ([[b6f7a4e0]]) deliberately gives keys builtin names (`modules`, `swallowed-failures`), while a project is free to name a key `names`.

- **No `name`** — a page of the functions this project's SDK offers: public functions whose pack is used in HEAD (`used` in the catalog). One line per form: `Loading.forbid — runtime loads from the selected files never reach the refused specifiers · loading · /rules`. The description is the builtin declaration's `summary`: one phrase with no parameters (`describe` is not built without parameters), and the concern is its `concern`, which `shows` overrides only where it depends on parameters (`names`). Behind them stand the custom inspection (`defineInspection`) and linters (`Linters.command` and named ones) — one line per shape. `names` and `platforms` are not in the list. Project config keys are not listed here either; `read_config` answers them ([[ecb31b4e]]).
- **`name`** — an SDK function (`Loading.forbid`) or a builtin id (`loads`; `names` and `platforms` answer so too). Namespaces do not intersect: a function name always contains a dot, a builtin id never does. Answer: a TypeScript signature — fields with types, optionals with defaults, one description line per field from the schema annotations; the fingerprint unit; the reach (`local`/`global`); `unblock` exits. The signature is the shape of the `params` of the description `{ builtin, params }` the function builds: `Loading.forbid(params)` takes it whole, while `Files.maxLines(lines, options?)` assembles `thresholds` itself, and the call's shape is given by the SDK types. At `defineInspection` and `Linters.*` the signature is the description schema that `config` uses to decode it. `signatureOf` from `@tagma/inspection` prints the signature; the AST description lookup that the `/rules` build uses to write JSDoc lives beside it. The server takes the function-to-builtin mapping by calling the SDK functions themselves, never from a second table.
- **`key`** — a HEAD config key (`domain-no-ui`). The answer is the same as by its function's name, plus the resolved description with defaults substituted and the rules pointing at it. `name` and `key` are not accepted together. The signature is built from the same schema that the SDK types are derived from and that the server decodes with ([[d9ef0c58]]), never written a second time.
- **`limitations: true`** together with `name` adds `limitations`.
- **`map: true`** — the module map, as now.
- `programs` and enforced-rule documents go away: the first no longer exists, the second is read by `read_enforcement` with the rule.

Read refusals: `not-found` for a name among neither functions nor builtins, and for a key missing from the HEAD config. Exits are the nameless list and `read_config`.

## Acceptance

Answers are measured on runlith in tool shape:
- list without `name` — at most 3,000 characters;
- `name: 'Loading.forbid'` without `limitations` — at most 3,000 characters, showing that only `from` and `refuses` are required;
- `key: 'domain-no-ui'` on the [[b6f7a4e0]] acceptance fixture — the description with defaults and the rule pointing at it.

The numbers are this work's targets: an agent picks a fitting inspection from an answer an order of magnitude shorter than today's. The check is an integration test through the operation on the same three calls.
