---
id: 01a0f826-e222-7653-b45b-f8c07489a79e
title: A call stands whole on the served graph of its place — graph services, store, measured checkout and tree — chosen by one rule in the call's services, never per operation
ord: 210
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/rules/reach.ts
    symbol: enforcedRules
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/routing.ts
    symbol: routedSeams
  - kind: symbol
    ref: apps/tagma/server/src/invocation/admission/services.ts
    symbol: callServices
---
The operator's word (2026-10-01, relayed by law-opus): "if a worktree is created, everything comes from that worktree". A call stands whole on the served graph of the place it is made from; one rule picks it, and no operation declares, forgets or loses it.

## 1. Outcome

- Every operation call — native door and HTTP door, every operation of the catalog — runs over the served graph its place resolves to: the graph's services, the store and units under them, the checkout the graph measures (`MeasuredCheckout`, so `measuredRoot`) and its tree (`ServedTree`). A thread in a worktree reads, writes, measures and judges that worktree's copy and checkout; a thread on the main checkout the main ones.
- The landing gate and every enforcement read (`read_enforcement`, `read_inspections`, `check_rules`, `enforce_rule`, `adopt_law`, `record_commit`) enumerate the same enforced rules for the same place.
- The operation catalog names no graph: there is no per-operation flag to set or drop.

## 2. Problem, with evidence

Live on runlith after the restart at 15:33 on 2026-10-01 (build with 30229ca3a5): `read_enforcement` answered "0 rules, 0 enforced", `read_inspections` measured none and `check_rules {rules:["39817e41"]}` refused `not-enforced`, while submit_work refused on 925aed1c and 50520d64 at 15:35–15:36. Reproduced in `composition/testing/enforcement/copiedLaw.itest.ts` (red before the fix).

Cause, read from the code: 114ed458f8 removed the per-operation `graph: 'checkout'` that merged the served graph's context into five enforcement operations. A call's context is now machine lifetimes, then routed seams, then call services. Routed seams cover the graph service tags and forward them to `CurrentGraph`, but the store under them (`GraphStore`, `GraphUnits`, `BlockRows`) and `MeasuredCheckout` stay the machine's ([[eb2b261c]]). A body that reads those directly — enforcement's `lawForest` read, every `measuredRoot` — reads the machine store and the project's main root, so a copy-stored project shows no rules, and a worktree caller is measured against the main checkout. The gate never diverged: `RuleChecks` resolves the served graph by the landing's root and runs in its whole context.

## 3. What holds now

- One resolution rule already exists: the pool resolves `{projectId, cwd}` ([[4ad9b8a3]] for a named branch). The native door resolves it from the thread's target graph ([[81ea3e88]]), HTTP admission from the request's `cwd`/`branch`, and the gate from the judged root.
- Call services are composed once, in `invocation/admission/services.ts#callServices`, for both doors ([[4657a163]]).
- [[81ea3e88]] claims every native operation is served from the copy; it holds for routed tags only.

## 4. Target model

`callServices` stands the call on its served graph: where the call has a served graph, its whole context enters the call services, then the routed seams over it, so the routed tags keep their once-per-call freshness ([[340ca26f]]) and the store, units, measured checkout and tree are the served graph's. Where no graph is served, the call keeps the machine graph as today. Enforcement asks the graph for a project's standing law-bearing blocks through the routed `Orientation.rules`, the same reader the instruction set and touches use, never `lawForest` over an ambient store.

## 5. Owners and boundaries

- `invocation` owns the composition (`callServices`); it gains the pool to build the routed seams over the served graph.
- `graph` owns `Orientation.rules` and the routed seams; `enforcement` reads rules only through it.
- No operation entry, door or body names a graph.

## 6. Rejected alternatives

- Restoring `graph: 'checkout'` on the five operations: the defect is exactly that a per-operation flag can be dropped, and any other body reading the store or `measuredRoot` stays wrong.
- Routing `GraphStore`, `GraphUnits` and `BlockRows` as seams: a store is a value, not a set of verbs, and the proxy would answer the machine's identity.
- Fixing enforcement alone (a served-graph lookup inside its readers): a second road beside the call's own graph.

## 7. Acceptance

- `copiedLaw.itest.ts`: on the main checkout and in a worktree, the rules `read_enforcement`, `read_inspections` and `check_rules` name at both doors equal the rules the landing gate crosses for that place.
- A catalog-wide contract: every operation of the catalog, called through the native door from the main checkout and from a worktree, and a call admitted at the HTTP door from each, runs over the store, measured checkout and tree of that place's served graph.
- Server typecheck clean for the changed files; the enforcement and serving suites that cover the call stay green.

## 8. Blocks touched

- [[81ea3e88]]: rewritten from the code to cover the whole call, both doors.
- [[eb2b261c]]: corrected — store, units, measured checkout and tree are the served graph's on a call that has one; the machine's otherwise.
- New claims from the code: the call's composition over its served graph, and enforcement's one reader of standing rules.
- Task [[a54da71b]] carries the work.

## 9. Order

Contract tests red; `Orientation.rules` and enforcement's reader; `callServices` over the served graph; tests green; claims; review.

## Divergence in building

§4 and §5 put the place context into `callServices`. Review found that HTTP owner lifetimes are provided inside the carried call and carry the machine store, so they put it back under the body. As built, invocation's `onPlace` provides the place context innermost around every body — native door, `performById`, `performIn`, `performOperatorIn` — and `CallFacts` gained no pool, which is read from `RoutedGraphs`. The graph owns `placeContext`, which leaves out the mirror's `ProjectPolicy` and `ProjectLifecycle`, because the project registry is the machine's. The outcome (§1) and acceptance (§7) stand as written.

## Questions 10–17

- 10 contract: no wire change; `Orientation` gains one member, filled by the graph's own layer.
- 11 stored data: out — nothing stored changes.
- 12 who may do what: out — permissions and consent are unchanged; the call's place already decides the graph.
- 13 long-lived things: the served graph stays held by the pool for the call as today; nothing new is held.
- 14 bounded resources: out — no new resource; one routed-seam context per call, built from the served graph already resolved.
- 15 rollout: takes effect at the next server start; running threads' next call stands on their place's graph.
- 16 failures: a place whose graph does not open keeps today's refusal (`RefusedGraph`) or the machine graph where no project is named.
- 17 observability: `read_enforcement` and `read_inspections` print the graph copy they read (`graph copy read:`); the contract tests above.
