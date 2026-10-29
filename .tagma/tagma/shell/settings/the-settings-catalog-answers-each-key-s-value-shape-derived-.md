---
id: 01a146c4-f7ae-7cc7-9e43-27a8498534f7
title: The settings catalog answers each key's value shape derived from its schema, and the setting-value refusal names it
ord: 2
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a146b3-b04a-7cb1-96a4-077ca37da6e5
sources:
  - kind: file
    ref: apps/tagma/server/src/settings/shape.ts
---
`value` in `write_setting` is any value: the shape depends on the key, and the tool's entry schema does not carry it. So the catalog carries the shape: each `read_settings` line answers `shape`, a line of the form `({ type: string (a value with a length of at least 1), to: "operator" | "agents" })[]`, and an agent sees it as a `holds:` line next to the description; the `setting-value` refusal names it first in unblock.

The shared platform renderer prints the shape from the representation (`SchemaRepresentation`) of the encoded side of the schema — the side `write_setting` and line reading decode the value by; settings cache their projection per key. Limits print in the `expected` words of Effect checks, recursion — by name with a `where` binding. JSON Schema does not fit here: it describes the JSON codec (`optional` as `| null`, `Number` with `NaN`/`Infinity` strings and no bounds), while a write rejects the value it promises.
