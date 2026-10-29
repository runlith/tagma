---
id: 01a0cf85-ce96-7f47-ae81-b199c7298ecf
title: apply_batch should publish the exact per-op contract it decodes by, in the standalone tools' field names
ord: 16
tags: ["idea"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/work.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/batch.ts
    symbol: batchOpSchema
---
## The question

`apply_batch` publishes one contract and decodes by another. The door's op schema (`graph.ts#batchOpSchema`) types a handful of fields and leaves the rest open; the batch decodes with the exact per-op union (`batch.ts#batchOpSchema`, twenty variants). The per-op field list lives as prose in `APPLY_GRAMMAR`. Should the door publish the exact contract, and should the batch speak the standalone tools' field names?

## Evidence

- 2026-09-23, thread `01a0cf08…` at #1200: a document with `"by": "$p3"` on three `close` ops was refused `bad-document` (`Expected array | undefined`). One extra model step, about 470k input tokens read from the cache. The only place the model could learn the shape was the grammar line `close {op, id, reason?, by?}`. At that time the published schema typed only `op`, `tags` and `fields`.
- 2026-09-19, thread `01a0cf1f…`: the same refusal. The search stopped at the 30,000-fact read ceiling, so there may be more.
- The interim fix ([[8642c671]]) typed `by`, `specEnd`, `body`, `sources`, `checked`, `all`, `specOk` and `ord` in the published op. That schema grew from 1,484 to 3,247 characters. It is still a flat object, and every provider projection (openAI, gemini, moonshot, flat-root-object) keeps `by` as an array. Natively, the kernel's model dialect now repairs a lone `by` in inline `ops` into a list.

## The direction we see

1. **Publish the exact contract.** Build the published op from the same declarations the batch decodes with, so the two cannot drift. Then drop the field list from `APPLY_GRAMMAR` and keep in prose only what a schema cannot say: atomicity, handles, the file road.
   - The published side is an INPUT schema. There `body` is a string or `{"file": …}`, because body files resolve before the grammar decodes. The exact union from `batch.ts` describes the document after that resolution and would deny the file form.
2. **One vocabulary with the standalone tools.** An op would be its tool's arguments plus `op`, so knowledge of a tool carries over. Today the two sides differ:
   - `id` vs `blockId` in update, claim, release, done, close, delete and restore;
   - edit's `old`, `new`, `all` vs `oldString`, `newString`, `replaceAll`;
   - verify's single `id` vs `blockIds`;
   - `body: {file}` vs `bodyFile`.

   Link, unlink, anchor, unanchor and supersede already agree. Inside the batch, anchor and unanchor use `blockId` while every other op uses `id`.

## What is measured

- Exact union: 9,609 characters. The eighteen standalone tools' schemas total 9,656. The size is the honest price of one tool over twenty verbs, not bloat.
- Net growth after the prose list is dropped: about 6–7k characters, roughly 1.5–2k tokens. It is paid only in requests after `apply_batch` loads, because the tool is deferred.

## What is unknown, and would decide it

- **Provider shape.** The exact union is `anyOf` over twenty variants with `$defs` and `$ref`. The flat interim schema passes every projection; the union was never run through them, nor sent to a live provider.
- **Where inline ops are judged.** With the exact schema at the door, a malformed inline op is refused as `body-shape` with Effect's union message over twenty variants. It carries no op number and no saved file to edit. The batch today refuses `bad-document`, naming the op, the field and the file ([[df867a0f]], [[894c00de]]). Keeping the door lenient while publishing the exact schema brings back the published-versus-decoded split this idea exists to remove. That choice has to be made explicitly.
- **Renaming is a format change.** `BATCH_OPERATION_ID_HELP`, the refusal ways that say "batch `update` does not use `blockId`", and their tests move with it. A batch `id` also accepts a `$handle`, which a tool's `blockId` does not.
- **Weaker models.** Nobody has measured whether they write a twenty-variant union worse than a flat object plus prose.
