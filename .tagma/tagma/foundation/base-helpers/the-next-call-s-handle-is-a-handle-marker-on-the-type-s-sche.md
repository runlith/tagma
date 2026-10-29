---
id: 01a15f1f-7024-7568-b3c3-602c5b850b93
title: The next call's handle is a `handle` marker on the type's schema at its owner; the own voice and the module voice print every answer handle
ord: 18
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15eb1-1b10-757c-ac79-89ebc8d8b62b
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/handles.test.ts
  - kind: symbol
    ref: packages/utils/src/printed.ts
    symbol: HANDLE
---
A module voice knows no foreign types, so the handle is declared by the type's owner, once: every field of that type in any answer is a handle, and the own voice or the module voice must print it however much it shortens the rest. The marker also carries the printed form — the voice prints the handle with it and the check looks for it; by default it is the value itself.

The `PRINTED` and `HANDLE` keys live in `@runlith/utils`, not in the server platform: handles are declared by packages below the server too — the execution address (`ExecutionId` and `Incarnation`), the host operation key, the command life revision, and `ByteOffset` in `@runlith/executions`, `PageCursor` in `@runlith/paging`. A field an agent passes on but declared as a bare string or number is invisible to the check: the page cursor in an answer is `PageCursor`, not `Schema.String`.

The check is `composition/handles.test.ts`, the unit layer. For every operation with `tool` and an own or module voice it builds an answer for every handle-carrying known `knownAnswer` branch via `Arbitrary.schema`, puts a distinguishable token in each handle, unique by path, and looks for its printed form in the text. It fills a handle in an optional field, `null`, and an empty array itself, and builds answers for a branch until every variant of every union carrying a handle lands in an answer at least once: nested-union variants are picked independently, not with one shared counter. A voice answering `UNVOICED` is skipped: the shared voice speaks for it and prints everything. An object nested in itself (a block's child in a page outline) is built once and requires only its direct handles: the agent reads the rest by its name.

Uniqueness by path means: a handle copy that in a real answer equals another — an edge end coinciding with the block itself, `state.ref` of the same execution — the voice prints only when it differs. A voice printing one handle instead of another is how the check catches it.

A schema for which `Arbitrary` builds no sample gets one from the owner: `toCodecArbitrary` at `Schema.declare` (transcript recording in `@runlith/agent/protocol/http`), a real format check at a string (`isBase64` at `WindowBytes`).
