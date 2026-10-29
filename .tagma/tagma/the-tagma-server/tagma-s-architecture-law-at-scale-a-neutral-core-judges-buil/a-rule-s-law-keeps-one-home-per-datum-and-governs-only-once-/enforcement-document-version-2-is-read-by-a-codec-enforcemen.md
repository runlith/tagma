---
id: 01a0f4ab-e2d9-7636-853c-1febcec43670
title: Enforcement document version 2 is read by a codec enforcement owns, free of the builtin union, and release N refuses to write over it
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4ac-8725-77e5-ad2e-9c5b0729e1d2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0506-7364-9447-e291172759d0
---
Release N (order A of [[9140c692]]). Build the reader of enforcement document version 2 in a codec `enforcement/` owns, free of the builtin union, and make release N refuse to write over a version 2 document. Release N writes version 1 only.

**Class:** complex — `claude-opus-5-5` high.

**Where to start:** `apps/tagma/server/src/graph/contract/wire/enforcement.ts` imports `BUILTINS`/`BUILTIN_IDS` from `@tagma/inspection/builtins` and decodes every builtin's parameters inside the graph's field codec (M5 of [[9140c692]]).

**Target** ([[172759d0]] §4.1, §5, spec-list 10–11):
- The graph decodes the `enforcement` field as an envelope — its `version` and shape — and nothing of a builtin; a builtin's parameters decode in `enforcement/` at use, by its id.
- Version 2: `{ version: 2, policy: { strictness, on, checks: [ { builtin, params } | { runner, id, params?, files? } ] }, adoption: {…} | null, ledger: { debt: [{ fingerprint, owner, count, value? }], escaped, baseline, measured } }`. `adoption` is decoded and kept; its content is written by [[172759d0]]'s later tasks.
- Version 1 decodes as today and is the only form written in release N.
- Release N refuses to mutate an active version 2 document — `enforce_rule`, the re-measure driver, any write — with a typed refusal naming both versions; it reads and judges it.
- An unknown version is `inspection-failed` at gate, never a silent skip; an unknown builtin id decodes and fails its inspection instead of failing the graph field.

**File scope:** `apps/tagma/server/src/graph/contract/wire/enforcement.ts`; `apps/tagma/server/src/enforcement/contract/wire/**`; `apps/tagma/server/src/enforcement/rules/{enforce,measure,reads,law}.ts`; `apps/tagma/server/src/enforcement/remeasure/**` where they decode; the field-schema registration of `lawEnforcement`. Not `apps/tagma/inspection/src/packs/**` (another task deletes builtins there), not `graph/vocabulary`, `graph/serving`, `graph/blocks/law.ts`, `graph/orientation/law.ts`, `graph/contract/wire/tags/` (the tags lead's tag-step-0).

**Acceptance:**
- No file under `apps/tagma/server/src/graph/` imports `@tagma/inspection` (grep).
- A version 2 document judges exactly as its version 1 equivalent in fixtures (a builtin rule at gate, a program rule).
- `enforce_rule` and the driver over a version 2 document refuse, typed, naming both versions; the document's bytes are unchanged.
- All 13 enforced rules of runlith decode and `check_rules over: all` reports the same violations as before.
- Typecheck of the server and `@tagma/inspection`; enforcement and graph unit tests.

**Reviewers:** one Muse lens (compatibility of stored documents), `claude-opus-5-5` xhigh, `gpt-6-astra` xhigh (law-astra).
