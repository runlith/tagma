---
id: 01a13292-a115-76da-af84-5bd736632cde
title: Behaviour `actions` declares status turns and operation slots; the tag line, refusals, and menu read one registry projection
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## What changes

The owner is the **turn**, not the word: the same word is written by different operations from different places (`initial` from active — the holder returning, from the end — reopen), and the `claimed` word is guarded only when the tag binds a holder. So `Behaviour.actions` becomes a structure of turns and slots, not a list of names:

```
actions: [{ op, moves?: [{ contract?, to: <meaning>, from?: <phase> }], writes?: [<slot>] }]
```

- `core/lifecycle`: `finish_block` → `done`; `close_block` → `closed`.
- `core/holder`: `claim_task` → `claimed` (a `core/lifecycle` word, as `core/amendment` verdicts name lifecycle words) and writes the `holder` slot; `release_task`: from active → `initial`, clears `holder`.
- `core/amendment`: three verdicts → their words.
- `core/enforced` (enforcement module): `enforce_rule` writes the `enforcement` slot; the module contract (`moduleContract`): `set_module` writes the module slots. Each in its own module manifest.
- Everything no turn declares — intermediate words and reopen from the end to `initial` — is done by `update_block`. This follows from the registry, not from a special case.

## What is derived from the registry

One projection, "tag turns and slots", in `TagTable`, built from the registry of behaviours and the tag's bindings:

- `update_block`: `status-operation` for a turn with an owner, `assertNotOperated` for a slot with an owner — `guardedStatuses`, `StatusVerb`, `operationOnlyTargets`, the reopen special case and the central `OPERATED_SLOTS` are removed.
- `illegal-transition` names the allowed turns together with their operations.
- The tag line (`voice/tags.ts`) prints from the bound contracts, one line per behaviour, with no roles and no duplicate `binds core/*`. For `#task`: `status open → in_work (claim_task) · done (finish_block) — work happened · closed (close_block) — ended without it · other moves: update_block`, `holder (claim_task, release_task)`.
- `read_vocabulary` serves this projection in its answer. The app (status menu, `restingState` in `TagCatalog.svelte.ts`) builds only on it: today it imports a hand-written `SHIPPED_BEHAVIOURS` into the browser (`composition/behaviours.ts`, a registry copy next to `BEHAVIOUR_REGISTRY` from the manifest) and compares the `in_work`/`open` words literally. The registry copy goes away; the manifest registry never reaches the browser, the projection arrives from the server, and there is no menu turn before the answer. The dead `wordsOfOperation` is removed.
- The `status` field description at `update_block`: "a move no operation owns — an intermediate word or a reopen; the tag's status line names the operation of every other move".

## Checking the operation in action

The operation id in `actions` is a string: importing the operation catalog into `contract/wire/tags/behaviour.ts` would create a cycle. So registry assembly (`registerBehaviours`) refuses when a behaviour names an operation missing from the catalog: a typo or rename does not pass silently.

## Verification

Integration on a custom tag with `initial`, an intermediate word, `done`, `closed`, and a holder: `update_block` to `done` refuses with `status-operation`, passes on the intermediate word, reopen from `done` to `initial` passes; `claim_task` sets `claimed` and the holder; on a tag with the `claimed` word but no holder, `update_block` to `claimed` passes (current behaviour, which the move to turns does not change). `read_vocabulary` answers turns with operations as data. Unit: registering a behaviour with an unknown operation refuses.
