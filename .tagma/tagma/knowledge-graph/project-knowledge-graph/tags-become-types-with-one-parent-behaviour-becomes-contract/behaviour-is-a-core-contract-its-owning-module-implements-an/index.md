---
id: 01a0f483-46b4-7a20-8471-e0b5877ba8f0
title: Behaviour is a `core/*` contract its owning module implements and registers; a type supports several compatible ones, roles translate one at a time with a check, and the core finds nodes only by contract
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[6bf40362]]. It replaces the closed list of roles with behaviour contracts owned by the modules that implement them.

## Outcome
- A **behaviour contract `core/*`** says what the core does with a node: a parameterized descriptor — which fields it binds, which words mean what, which actions it offers — implemented by the owning module and registered by that module's manifest. There is no central list.
- A type may support **several compatible** contracts: a decision is lifecycle + evidence + promise. New behaviour is its owner's code and descriptor, with no edit of a shared enumeration.
- Core functions find nodes only through "supports a contract", never by a project's type.

## Compatibility of several contracts on one type
Compatible if their bindings share no field and no single-valued state, and their requirements close (the `work` contract requires `lifecycle`, `enforced` requires law). A shared dependency is deduplicated only when its fields, parameters and actions are identical.

## Translation of roles
Roles are translated into contract bindings by a table, **each role separately, with a check**: the former answers and prohibitions over existing data are the first criterion. Meaning is not mechanism — a promise and an amendment carry evidence but are not a statement of the present; a leaf without children is not a saved selection; a user's observation is not a Tagma reflection — so each gets its own contract.

## What holds now
The roles `status, holder, work, decision, claim, container, law, amendment, leaf, observation, enforcement` are a closed list in `graph/contract/wire/tags/declaration.ts` (`OWNED_ROLES` at :112); `#idea` and `#research` bind none, so the brief and the batch name them as literals (`graph/orientation/briefs.ts:166,215`, `graph/work/Batch.ts:101`).

## Neutrality
Two contradictory workflows are two types bound to `core/work`; `ready_tasks` finds both by the contract, and `finish_block` applies the machine of its own node. A book project works on `core/truth`, `core/work`, `core/law` and sees no core word but the contract ids.

## The law contract and enforcement's predicate
Enforcement owns the law and enforced contracts, including the codec of the `enforcement` field — its version 2 codec free of the builtin union ([[fd53d2cb]], [[172759d0]]) is where `#rule`'s `law`/`enforcement` roles become the contract registered in enforcement's manifest. Enforcement's one predicate module answers "is a rule", "is an open debt owner" and "does an adopted rule stand on this type"; it reads today's roles and, at this step, swaps to contracts. An open debt owner is a node supporting the work contract or the promise lifecycle, in a non-terminal state, not replaced.

## Rejected
- **Mechanical translation of roles:** merges meanings that share a mechanism.
- **External behaviour plugins:** behaviour stays core code.

## Acceptance
- For every role, the translated binding answers what the role answered over the existing data, checked role by role.
- No core function selects nodes by a tag name; the neutrality test of [[6bf40362]] §7 passes.

## Spec-list questions
Answers 1–7. Owners: each contract's module ([[6bf40362]] §5). Fates and order: [[6bf40362]] §8, step 2. 10: the descriptor is registered through the owner's manifest. out: 11–17 — no store of its own; rollout under [[fcaf4455]].
