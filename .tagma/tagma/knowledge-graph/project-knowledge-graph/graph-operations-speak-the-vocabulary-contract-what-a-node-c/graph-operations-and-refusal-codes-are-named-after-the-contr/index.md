---
id: 01a13292-a115-76da-af84-5bdbc3ad3db4
title: Graph operations and refusal codes are named after the contract they work on
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## Principle

A graph operation and its refusal code are named after what they work on: the `core/*` contract the node binds, not one catalog's type. A project tag that binds the contract gets its operations, and their names must be as correct for it as for the shipped type. When the verb itself names the contract's act (take, give back, end, close), the subject is `block`; otherwise it is the contract's noun.

Today this principle holds halfway: `finish_block`, `close_block`, `read_law`, `set_module`, `answer_reflection` follow it; next to them stand `claim_task`, `enforce_rule`, and `accept_proposal`, which break it.

## Renames

| Today | Contract | Becomes |
| --- | --- | --- |
| `claim_task`, `release_task` | `core/holder` | `claim_block`, `release_block` |
| `ready_tasks` | `core/work` | `ready_work` |
| `accept_proposal`, `reject_proposal`, `uphold_proposal`, `revise_proposal`, `read_proposals` | `core/amendment` | `accept_amendment`, `reject_amendment`, `uphold_amendment`, `revise_amendment`, `read_amendments` |
| `enforce_rule`, `set_rule_enabled`, `check_rules` | `core/law`, `core/enforced` | `enforce_law`, `set_law_enabled`, `check_law` |
| batch `claim`, `release`, `done`, `close`, `accept`, `reject`, `uphold` | — | match the operations: `claim`, `release`, `finish`, `close`, `accept`, `reject`, `uphold` |

Refusal codes: `not-a-task` → `no-holder`; `task-required` → by the required contract; `not-a-proposal` → `not-an-amendment`; `proposal-shape` → `amendment-shape` (merges with the existing one if the meaning matches); `amends-a-proposal` → `amends-an-amendment`; `not-a-rule` → `not-law`; `rule-disabled` → `law-disabled`.

The performer starts with a full inventory: every graph operation id and every graph and enforcement refusal code, checked against the contract it works on. The table above is what writing the spec found; the inventory completes it by the same principle, not at discretion. Operations outside the graph (`send_task` of collaboration, command rules, app views) are out of scope: they do not work on nodes by contract.

## How

One change with no aliases and no second form: the operation catalog and module manifests, behaviour `actions` from [[36632cde]] (their registration check catches a missed name), the batch grammar, doctrine and agent definitions, skills, refusal texts (`unblock` names the new names), the app, tests. Stored data naming an operation id — thread approval grants (`delegation` names acts by id), the graph journal — is translated by one database migration and one graph step; the journal keeps acts in its own words (`claim`, `done`, `close`), and the step changes only what names the operation.

## Verification

The inventory is attached to the task as an "id → contract → name" table. Integration: `claim_block` on a custom tag with a holder takes it, on a tag without a holder refuses with `no-holder`; `ready_work` finds open work of its own tag bound to `core/work`; a thread grant issued before the migration to `claim_task` permits `claim_block` after it.
