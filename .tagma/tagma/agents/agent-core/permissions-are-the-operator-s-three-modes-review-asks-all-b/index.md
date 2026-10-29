---
id: 01a0f9a9-a2cb-70ac-ac38-efa4f6f8e9c5
title: Permissions are the operator's three modes — review asks all but pure reads, trust asks its list, bypass asks nothing — and sanity limits are the only other refusals
ord: 174
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadSpawnTree.ts
  - kind: file
    ref: packages/agent/src/permissions/vocabulary.ts
---
## Outcome

The operator sets one of three modes and nothing else decides whether a call runs:

- **review** asks before every call except a pure read — a tool that mutates nothing and declares only read subjects (read, grep, glob, ls, read_block, search_blocks…). Every bash command asks, as does every write, spawn, message and network reach.
- **trust** asks only where its ask list names: the capability floors standing today — putting a thread away beyond the caller's own subtree, deleting a thread, pinning, folders, reading another project's threads, writing a setting, acting on managed executions, a child in a new worktree, another project's graph. Everything else runs.
- **bypass** asks nothing.

Beside the modes stand sanity limits only: a combination that is counter-intuitive and harmful is refused by the owner of the act, naming why, under review and trust; bypass lets it through. The set:

- an agent never archives, deletes, stops or interrupts its own thread or any of its ancestors (refusal code `own-lineage`);
- the structural verbs keep their shape: only an ancestor continues, compacts, rewinds, moves or stops a child.

A child's tools come from its definition's capabilities; nothing narrows them at runtime.

## Removed

- `spawn_agent`'s `reach` (read|write), the read-reach denial rule and the authority narrowing behind it.
- The thread verbs' `reach` (spawned|any), `Actor.reach`, the `thread://reach/any` subject and `not-a-descendant` on archive and delete: the server reads the target's relation to the caller from the spawn tree, and the trust ask for putting away beyond the subtree matches that computed relation.
- The rights vector: `rights` on spawn, on rows and on definitions, and the lineage grant read; `interrupt_agent` is every agent's, under the sanity limit.
- A definition's `rules` and `rights`.
- Owner-authored rules and "always" grants: their stores (`thread_owner_rule`, `thread_owner_rule_withdrawn` — no rows on the operator's machine), the consent source, the question's "always" answer, and subject bindings wherever a grant was their only reader.
- A thread authority's inherited `rules`: an authority is its mode and where bypass came from.
- The `deny` verdict, once nothing reads it.

Stored data is migrated once and dropped in the same change. Prompts, tool descriptions, doctrine sections, the UI and the graph lose every word about what was removed.

## Architecture

The kernel evaluator answers from the mode: bypass allows; review asks unless the call is a pure read; trust asks where a capability floor matches. Capability floors keep their declaration road. Sanity limits are refusals at the act's owner — the thread endings and list for archive and delete, the collaboration plane for interrupt and stop — reading the lineage the spawn tree already reads and the caller's mode.

## Acceptance

- A child spawned with no reach writes files and runs bash under its mode alone.
- A subagent archiving or deleting its parent is refused `own-lineage` under trust and review and runs under bypass; the root agent deleting another root thread asks under trust and runs under bypass, declaring nothing.
- Under review a bash `ls` asks and `read` does not.
- Typecheck and the unit and integration suites of the touched packages pass; `rg` finds no type, field, word or column of the removed mechanisms.
