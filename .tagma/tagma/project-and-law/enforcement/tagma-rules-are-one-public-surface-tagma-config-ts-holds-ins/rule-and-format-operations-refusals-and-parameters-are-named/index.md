---
id: 01a156d9-a73e-7045-bbfd-b088ecb31b4e
title: "Rule and format operations, refusals and parameters are named with the words rules and format: `enforce_rule`, `check_rules`, `set_rule_*`, `read_config`, `format-*`"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a13292-a115-76da-af84-5bdbc3ad3db4
sources:
  - kind: file
    ref: apps/tagma/server/src/commit-steps/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/contract/wire/operationCatalog.ts
  - kind: file
    ref: apps/tagma/server/src/graph/steps/renamedOperations.ts
---
Rule and format operations, refusals and parameters speak the words of the product — rules and format. This is part of [[b6f7a4e0]]; it lands first because the other parts already write the new names.

## Renames

| Now | Becomes |
| --- | --- |
| `enforce_law` | `enforce_rule` |
| `check_law` | `check_rules` |
| `set_law_enabled` | `set_rule_enabled` |
| `set_law_delivery` | `set_rule_delivery` |
| `read_commit_steps` | `read_config` — a new operation of the `config` module (declaring what HEAD's `tagma.config.ts` holds), not a rename |
| refusals `commit-step-missing`, `commit-step-failed`, `commit-step-cut` | `format-missing`, `format-failed`, `format-cut` |
| `submit_work.withoutSteps`, answer `stepsSkipped` | `withoutFormat`, `formatSkipped` |
| skill `commit-steps` | `format` |
| "Commit without steps" button, "Commit steps" line in settings | "Commit without formatting", "Format" section |

This work's new refusals are `config-invalid` and `inspection-unknown` ([[b6f7a4e0]]).

Not renamed: `read_law` and `tagma law` (the AGENTS.md section), `law-unread`, `law-disabled`, `not-law`, the `core/law` contract, the "law of the place" in delivery. Those words mean other things, and they are the next work. The modules' internal names (`commit-steps`, `CommitShape`, `enforcement/`) do not change either: the user never sees them, and they still mean what they say.

## Why this changes [[c3ad3db4]]

[[c3ad3db4]] named operations after the contract they work over (`core/law`, `core/enforced`), and that is how `enforce_law`, `set_law_enabled` and `check_law` came about. The principle is sound, but the contract's word stands on no surface a person or agent sees: the tag is `#rule`, the screen is Rules, answers say "rules". An agent looks an operation up by the product's word. So the names return to rules now, and renaming `core/law` will bring agreement with the contract in a later work. Until then, operations and the contract are named differently, and this spec says so.

## How

Following [[c3ad3db4]]'s pattern: one change with no aliases and no second shape.

- The operation catalog (`enforcement/contract/wire/operationCatalog.ts`, the graph's `set_*` operations, `commit-steps/contract/wire/operations.ts`), bodies, contract-behaviour `actions`, `unblock` texts, `meaning` and `grammar`, voice and renders.
- Doctrine, the `rules` agent definition (`native-harness/agents/rules`), the skill, the `#rule` tag declaration and the software-development catalog guidance, `limitations` texts and the builtins' declaration `unblock`s.
- The app: `features/rules`, `features/settings` (`SettingsRepo` reads `read_config`), `features/checkout` (`CommitFlow`, `CommitBox`).
- Stored names: one database migration translating thread-mandate grants (`thread_mandate.approves`) and settings values that name operations, like `20261013021000_graph_operation_names`. A graph step in `graph/steps/` translating `on.op` triggers of enforcement documents, like `operationNames.ts`; the pair of new names joins `RENAMED_OPERATIONS`. The journal keeps acts in their own words (`enforce`, `remeasure`), and the step does not touch it.
- Standing graph blocks that name old operations as current (features, explanations, rule bodies) are fixed in the same change. Closed history stays as it is.

## Acceptance

- A thread grant on `enforce_law` issued before the migration allows `enforce_rule` after it (integration, following [[c3ad3db4]]'s check).
- The catalog answers `enforce_rule`, `check_rules`, `set_rule_enabled`, `set_rule_delivery`, `read_config`; old names refuse `unknown-operation`.
- Finding old names is acceptance item 7 of [[b6f7a4e0]].
