---
id: 01a156d9-a73e-7045-bbfd-b08bc3e35102
title: Rules screen lists every rule by name, text ones too, and shows an inspected rule's key
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633958074d0c
  - kind: relates
    to: 01a1564f-f5fd-73dc-8a3d-31b0c20b1cca
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/rules
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/engines.ts
---
The Rules screen lists every rule of the project by name, including rules with no check, and shows an inspected rule's key from `tagma.config.ts`. Part of [[b6f7a4e0]].

## What stands now

`RulesPage.svelte` builds rows only from enforced rules: `read_enforcement` without `rule` answers `rules` only for rules with a document. Text rules appear as one line, "N other rules carry no check; agents follow them as text", with no names ([[c20b1cca]]). Groups follow the builtin's concern, and everything else falls into "External linters", including project programs: `concernOf` looks only at `kind: 'builtin'`. The screen re-reads only on `enforce` and `remeasure` events, so a new text rule only appears after a reload (derived from code in [[c20b1cca]]).

## What will be

- **`read_enforcement` without `rule`** answers a page of every `#rule` of the project. A row gains `inspection` (a key or `null`), `function` (`Loading.forbid`, a custom inspection's name, or a linter's) and `delivery`; `enabled: false` is shown too. A text rule's row carries only name, title, source places, `delivery` and `enabled`; its `strictness` is `null` but no longer means "unreadable": a separate `unreadable` flag says that. `counts` does not change.
- **Groups**: inspections' concerns, as now. A custom inspection stands in the group of its `defineInspection` concern, only linters stay in "External linters", and a rule whose inspection cannot execute (no key in the HEAD config, config does not execute) stands in "Cannot run". A disabled rule with a document shows its key. Below — "Followed as text": rules with no check by name, marked with `code`/`prompt` delivery; disabled rules are dimmed. The line counting rules with no check goes away, because they are now visible by name.
- **An enforced rule's row** shows the key beside the title, in quiet monospaced text, and the hint shows the function. The rule's engine page names the key, the function, and that the description stands in `tagma.config.ts`, and draws the description's shapes as now.
- **Updating**: the screen re-reads on `#rule` block changes too — creation, edit, deletion, `set_rule_enabled`, `set_rule_delivery` — not only on `enforce` and `remeasure`.
- The screen still only reads (rule 0f144655): no new buttons or panels.

The screen asks for 500 rows (`WHOLE` in `Repo.ts`), and the page answers at most its ceiling — the tool answer envelope divided by the `ENGINES` row weight, currently 194; at runlith 190 rules, so the screen reads everything in one call; "Show more rules" stays for larger graphs. Disabled rules come from `Orientation.rulesOff`, beside enabled `Orientation.rules`.

## Acceptance

- `read_enforcement` without `rule` on a fixture with one enforced and one text rule answers both rows: the first with key and function, the second with `inspection: null` and the title (integration through the operation).
- The screen builds groups and rows only from these fields: no separate UI test (rule 4f387de2), and the implementer's check is the app typecheck plus reading the answer above.
- After `create_block` of a new `#rule`, the screen shows it with no reload: the page subscribes to this graph feed event.
- Feature [[58074d0c]] speaks the new words — "Rules with no check are listed by name" instead of today's limit.
