---
id: 01a13292-a115-76da-af84-5bd6229fd769
title: "Graph operations speak the vocabulary contract: what a node can carry, which operation makes each turn, and what it is called, is visible before the call"
ord: 38
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## What the user gets

An agent writes to the graph on the first try. What a block can carry — which edges, which statuses, and which operation makes each turn — it reads in the tag declaration before the call, and the operation accepts exactly what the declaration allows. For a project's own tag this is as true as for a shipped one: declare an `#experiment` — its edges are set at birth, its status line names each turn's operation, and the app menu speaks its words.

Today this is not so. The runlith orchestrator received three refusals in a row on one record (2026-10-12): `create_block` with an invented `relates` (`body-shape`), `discoveredFromId` on an untagged node (`edge-undeclared`), `update_block status: done` on its own `#experiment` where `done` was the closing word (`status-operation`). Every refusal was correct; the surface that suggested each error was not.

Measured across threads (2026-10-12, incomplete: activity keeps about a day, reads hit the facts ceiling; the full slice — 168 threads with activity per day, their whole history): 281 graph write calls, 8 refusals (2.8%), 3.9% over the last day. All eight are of the same kind: a field the schema does not know (`relates` in `create_block`, `edge` instead of `kind` in `link_blocks`) — 3; `waits-on` from a spec to a task (`edge-shape`) — 3, three in a row in one step; `edge-undeclared` — 1; `status: done` via `update_block` — 1. Two refusals the agent never recovered from, one cost two extra calls. Each is a call diverging from the contract the surface did not show before the call.

## Root

Decision [[877ba8f0]] made the node's meaning the `core/*` contracts: a behaviour declares fields, words, and actions, and there is no central list. Fields and words are done to the end; **actions and edge meanings are not.** So one fact is derived in several places, and the surface speaks in the words of one catalog:

1. **Who makes the status turn** is derived by `guardedStatuses` (`graph/contract/wire/lifecycle.ts`), the central `OPERATED_SLOTS` (`blocks/guards.ts`, holds enforcement and module slots), the reopen special case in `blocks/update.ts`, and the dead `wordsOfOperation`. `Behaviour.actions` — where this fact should live — is declared on every behaviour and read nowhere. A tag declaration prints the role as raw JSON and names no operation; `illegal-transition` lists targets without owners.
2. **Edge meaning** is given by the core by name: `waits-on` and `implements` in `blocks/linking.ts` and `acts/measurement.ts`, `discovered-from` in `journal/feed.ts` and `orientation/briefs.ts`, and `accept_proposal` writes `discovered-from` with a raw `insertEdge` bypassing the check (`work/proposals/verdicts.ts`). A tag learns its `waits-on` is wrong only at binding time.
3. **Edges at birth** — two special ones out of many: `implementsId` and `discoveredFromId` on `create_block`, the create-op of `apply_batch`, and the create-op of `#proposal`; the birth form in four copies (`operations/shared.ts`, `contract/wire/batch.ts` three times), the batch grammar a manual fifth.
4. **Names of one catalog**: `claim_task`, `ready_tasks`, `accept_proposal`, `enforce_rule` work on any node of their contract but are named after one catalog's type, next to correctly named `finish_block` and `read_law`.
5. **Texts of one catalog**: `close_block` "Closed without doing it" — false for an accepted spec; `finish_block` "Mark a task done"; `claim_task` "set in_work", `release_task` "return it to open"; the `not-a-task` refusal code; `link_blocks` "the waiting task"; the batch verb `done`; the app status menu "Start work", "Close as not needed" (`TagCatalog.svelte.ts`).

## Solution

Every fact has one owner, the contract's behaviour; surfaces read one registry projection:

- [[36632cde]] — status turns and the slots an operation writes are declared by behaviour `actions`; everything else is derived.
- [[26568d3b]] — behaviour declares edge meaning; `discovered-from` is core provenance on any node.
- [[1b4a6f2a]] — birth takes its edges as a list through one check.
- [[b8a3738b]] — operation texts, display, and the app menu speak contract meaning.
- [[c3ad3db4]] — operations and refusal codes are named after the contract they work on.

Build order: [[36632cde]] · [[26568d3b]] → [[1b4a6f2a]] → [[b8a3738b]] → [[c3ad3db4]]. [[36632cde]] and [[26568d3b]] are independent; [[1b4a6f2a]] builds on the provenance from [[26568d3b]]; [[b8a3738b]] prints the [[36632cde]] projection; [[c3ad3db4]] renames everything the previous ones named, in one change, last.

## Scope

- Status turns, operation slots, the status line, `update_block status`, `illegal-transition` — [[36632cde]].
- Edge meaning, `discovered-from`, tag-declaration check — [[26568d3b]].
- Birth edges on all birth doors, the birth form, the batch grammar, the graph step for stored proposals — [[1b4a6f2a]].
- Operation and refusal texts, display, app menu — [[b8a3738b]].
- Operation and refusal-code names, the contract inventory, the stored-grant migration — [[c3ad3db4]].
- out: two binding forms in the declaration (`roles` and `contracts`): the vocabulary format, not the operation contract; this spec reads both through the existing `lifecycleOf`/`bindingTag`.
- out: approval (`other-project`, `held-elsewhere`) does not change.
- The `#experiment` declaration (its closing word was `done`) is fixed by a separate act before this spec: `done` is `done`, `closed` is `dropped`.

## How to verify

Structural criterion (read from code, not a test): `guardedStatuses`, `StatusVerb`, `OPERATED_SLOTS`, `wordsOfOperation`, `SHIPPED_BEHAVIOURS`, `provenanceEdges`, `implementsId`/`discoveredFromId` are removed; the tag line, `read_vocabulary`, refusals, and the app menu read one behaviour-registry projection.

Contract criteria are in each part. Operator: on the polygon an agent creates an `#experiment` with an edge and takes it to `done` without a single refusal.
