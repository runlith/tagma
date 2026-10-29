---
id: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
title: "Section 7: Tagma is rebuilt in dependency-ordered waves, one card per server module, each card fixing every current file's target path, name or split, its transitional bindings and its acceptance"
ord: 63
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: supersedes
    to: 01a0e43c-d0e1-7fca-9745-e5184c09d51e
---
# Tagma architecture spec · Section 7. Order and module cards — draft v5

**Question answered:** in what order the 27 server modules of section 1 are rebuilt, and what one builder needs to rebuild one of them. A builder opens its module's card and needs nothing else to start the wave: what the module owns, what it offers and needs, its tables, lanes and operations, **every current file it receives with its target path and name**, the debt it retires, the graph work, and how the wave is accepted.

**v5:** final pass over the four Sol slice reviews [[23a1feed]]: W1 model selection and setting-key catalog remain runnable, D4 blocks the record's final map, checkout picture remains binary HTTP, served-tree path existence and change-row task labels keep their owners, PaceDoor binds the current host, preservation gains real keyed publication before worktrees, MergeNotice changes jointly with threads, the three unowned socket feeds and ten thread act verbs gain owners, and `composition start` is called from the old runtime before projects. Accepted §3.13 [[9c085c6c]] supplies the journal-lane, keyed kernel transition and authoritative-record contracts (§7.2.2–7.2.7, the affected cards). No code or rule is activated by this draft.\n\n**v4:** revised once against both v3 reviews (Sol, Astra: holds after fixes) and the launcher's consolidated brief. The milestone graph now carries every transition dependency as an edge — K5a as a tracked task, narrowing waits on the doors and all current importers, `composition M2` waits on every module's `M2`, the settings remainder keeps its owner, P4 waits on P3 (§7.2.2); D4 carries its runtime readiness in the current paths (§7.2.4); every mandatory face of an early `M1` has a named old producer, semantics, installation point and replacement (§7.2.7); platform's public machinery lives in `contract/`; one indivisible claim keeps several sources (§7.4.6); the two unregistered edges close by meaning (`actorOf` to executions; `ProcessProvenance` in platform, the vacuum voice by manifest); the eight group-covered files and the new operations' contracts are explicit; all 18 F3 candidates are resolved and `terminals/start.ts` needs no F4 allowance (§7.4.2); the control reads structured source→target pairs (§7.6.1). The amendments this needs in sections 1, 5 and 8 are listed in §7.8.

**v3:** revised once against the independent Sol and Astra reviews (both: holds after fixes). The preparation has a vocabulary release barrier and task shells before any debt (§7.2.1); milestones are child tasks joined by `waits-on` edges, `M1` leaves a runnable system and narrowing waits on incoming consumers (§7.2.2); `.tagma` stays graph's and travels as an argument; the native context actions and the workspace-source reload go to `native-harness`; registry restore, policy export and the commit-queue downgrade preflight are separate contracts (§7.5.9, §7.5.15); section 5's decided operation, journal and key names are applied; the thread routes are enumerated (§7.5.20); the source plan uses the graph's real operations (§7.4.6); the reconciled territory evidence is §7.6.1. The package, app and desktop cards are part 2 (`spec-07-packages.md`), not this file.

This section carries the frame — the wave order (§7.2), the card template (§7.3) and the rules every card applies (§7.4) — and one card per server module (§7.5).

**Builds on:**
- section 1 v10 [[f658e190]] (`spec-01v10-modules.md`): the 27 modules, the relation registry `spec-01v10-relations.mjs`, the territory `spec-01v10-territory.mjs`, the wave groups W0–W7 (§1.11) and the "Wave order" of §1.7;
- section 2 [[70083b67]] (D0–D9), section 3 [[511b13e3]] (E0–E8) and its accepted §3.13 addendum [[9c085c6c]] (E1–E5, journal lane, keyed kernel transitions, authoritative records, D9 bounds), section 4 [[d925fa0c]] (K0–K6), section 8 [[e04cfdcb]] (§8.5 zone agents, §8.7 graph work), section 9 [[6bf40362]];
- section 5 [[243fd181]] (`spec-05-names.md` v3.1, approved): its glossary, F1–F7 and S1–S7 as **signals** (a rule measures a syntactic fact and never prescribes the fix; a split follows named subjects only), §5.4.3 identity types, §5.4.6 table names, §5.4.7 map shape. Its decided words are used throughout: `landing` (the module), **sync** (the graph's P3; act phase `synced`, journal answer `recorded`), **lifetimes** (section 4's call levels; **context** is only what a model sees), `Actor.session`, `ActorRef`, **environment backend**, **driver** (only what drives a maintenance act), `Harness.current`, `thread_mandate`, `WorkspaceGeneration`, `CommandSubject`, `ScreenViewerId`/`ViewLeaseId`, `HostRequestKey`;
- section 6 v2.1 [[be799808]] (approved): its package owners — the new `paging` and `held` packages; fixtures that assemble several modules, and the capture driver, go to `composition`'s test world.

**Measured at** `98d8d3a216`, a frozen baseline. The checkout has moved since (Astra observed `9fb0d559ee` with a parent notice added to `harness/ThreadActs.ts`), so every wave begins with a delta review (§7.2.2). File-to-module assignments come from section 1's territory script over the snapshot, corrected by §7.6; §7.6.1 states which maps were read whole and which rest on fact-sheet line ranges. Nothing in the repository or the graph was changed; no test or typecheck ran.

## 7.1 Outcome

- **One order, checked on the registry and held by task edges.** Each module's wave opens when the modules it depends on have published runnable contracts (`M1`), not when their whole waves close; its entries narrow only after its incoming consumers have moved (`N`). Several builder sessions work at once without waiting on unrelated work (§7.2.2, §7.2.5).
- **One card per module, complete before its wave opens.** Its file map covers every file section 1 assigns to the module and every part it receives from a file split across modules. Builders rename by the map and never invent a name (section 5 §5.4.7); a file or symbol the map misses is a question to the card's designer.
- **Preparation before wave 0.** Release N's vocabulary barrier runs before section 9's new vocabulary is written; the wave tasks exist before any debt is measured; `modules` and `names` stand at gate over the server region with today's violations as debt owned by those tasks, and say which regions they do not cover yet (§7.2.1).
- **Section 1's territory is corrected where reading the files contradicts it** (§7.6). The corrections are by meaning; none adds a relation to the registry.

## 7.2 The wave order

### 7.2.1 Preparation — before any wave opens

The order follows section 8 §8.9 (section 9's steps, then the zone agents, then the `modules` rule, then the waves) and section 9 §9.15's two-release rule. Each step names what it waits on; "independent" is claimed only where no step reads another's output.

| Step | What | Owner of the work | Waits on | Done when |
|---|---|---|---|---|
| **P0 — release N: the vocabulary barrier** | Section 9 §9.15 step 0 (§9.7): the vocabulary format marker in every graph store and tree descriptor, and the refusal to **write or install** under a newer format than the running binary understands. Today `graph/core/Tags.ts#tagsLayer` (L466–489) can discard a declaration it cannot read; release N makes a newer-format declaration refuse typed instead of being dropped. This is the early part of D1 (section 2: "the vocabulary format marker and tree descriptor with the old-writer refusal"); the rest of D1 stays in `graph`'s wave | `graph`'s current code | — | release N is cut and **running** on every server that opens the project's trees (one operator: the server restarted onto it; team mode: every member's server, confirmed by the operator — no operation reads another member's release today) |
| **P1 — task shells** | One `#task` per module (27), each with three child tasks `M1`, `M2`, `M3` and one `N` (narrowing, §7.2.2); the cross-module tasks of §7.2.4. Each wave task carries its card; the `waits-on` edges of §7.2.2 are written between the child tasks. A package or app card's task is added when its group stands (part 2), with the same shape | the graph (`apply_batch`) | the server cards of this section (v5) are accepted for implementation | `ready_tasks` (`list_ready_tasks` once section 5's rename lands; the old id stays its alias) shows exactly the `M1` tasks whose start rule holds (at first: `platform M1`) |
| **P2 — release N+1: section 9 to the extent the waves need** | Section 9 §9.15 steps 1–6 as far as the waves read them: the declaration compiler with identity, the `core/boundary` contract with a territory parameter, the `core` library (`#reflection`, `#view`, `#proposal`) | `graph` (vocabulary engine), `catalogs` | P0 running (the release barrier; a release that writes the new vocabulary is never cut before N runs) | a `#module` with a `dir` source and a territory measures under `modules` |
| **P3 — zone agents** | Section 8 §8.5: `zone-cutter` reads the target map, the relation registry and the card; `zone-builder` writes a limitation claim with the wave task for code the target says leaves; `zone-reviewer` reads against the target and sections 2–5 and sets no `HOLDS` over what it did not read | runlith's `.agents/zone-*.md` | P2 (they write `#module` territories) | the three agent files pass their own review |
| **P4 — the `modules` rule** | The builtin with section 1 §1.7's needs: the snapshot in parameters through `enforce_rule`; tightening without a question; node selection by role; `entries`, `cycles`, `coverage`, `unresolved`, `files`, `reads`; nested territories; debt with file sets; affected consumers of a changed export; checked vs unmeasured; debt that follows a moved violation | `apps/tagma/inspection`, `enforcement`'s current code | P1 (every debt entry is written with its owning task, never ownerless); P2 and **P3** (section 8 §8.9: section 9's steps, then the zone agents, then `modules`) | at gate over **the server region** `apps/tagma/server/src` with the first snapshot: one physical owner per file (the reconciled territory of §7.6.1), entries = whole module, `unresolved: refuse`, each standing edge as debt `<consumer> → <target>` with its file set, owned by the consumer's `M2` or `N` task |
| **P5 — the `names` rule, scoped** | Section 5 N0: F1–F7, S1–S7, `literals`, the glossary v3.1 as parameters; its benchmark and envelope first (section 5 R6) | `apps/tagma/inspection` | P1 | at gate over **the server region only**, first-run debt owned by the server wave tasks. **The packages, the app and the desktop shell are not covered** until their cards stand and their tasks own their debt (section 5 R8); until then the rule's region parameter excludes them by name, and every report of the rule says so. The region widens through `enforce_rule` (a tightening) per package group |
| **P6 — the floor rule** | [[f49f228f]] stays at gate. Each new top-level directory is placed on its floor through `enforce_rule` in the change that adds it | each wave | — | — |

**W0 opens** when P0 runs, and P1, P4 and P5 stand; P4 already waits on P3, so the zone agents stand before any wave. No step claims coverage it does not have: until the package and app cards stand, `names` covers the server region only, and `modules` covers the server's 891 files and the package relations section 6 registers.

### 7.2.2 Milestones of one wave, and when a wave may open

Every module wave passes three milestones and one narrowing, each a **child task** of the wave task and each a merge of the wave's worktree into `main`. A milestone is done when its task is finished (`finish_block` naming the commit). Every start condition below is a `waits-on` edge between tasks, generated by `control/milestones.mjs` into `spec-07-milestones.json` (§7.6.1); prose adds no condition the graph does not carry.

- **Delta review (the first act of `M1`).** The card is measured at `98d8d3a216`. Before the wave's first change, the builder diffs every file of the card's map between `98d8d3a216` and the wave's checkout (`git diff --stat 98d8d3a216 <head> -- <files>`) and reads each changed file's change; a new file, a moved symbol or a new importer goes into the card as an amendment before the wave cuts anything. The server tree has already moved (for example `harness/ThreadActs.ts` gained a parent notice by `9fb0d559ee`); frozen evidence is a baseline, never proof of today's files.
- **M1 — contract and runtime ready.** The module's directory exists and is placed on its floor. `contract/wire/` and `contract/service/` define the types, services, ports and hooks its dependents need; `<module>.ts` assembles its layers and manifest. The parts of mixed files it receives are moved in (§7.4.4). Every importer compiles against the new paths in the same change (rule [[8183e6ef]] allows no re-export). **The system builds and runs after the merge**: every mandatory face the module declares is bound at `start` either to its real implementation or to the **transitional binding named in §7.2.7** — a named old producer with the face's transaction, permission and lifecycle semantics, a named installation point and a named replacement milestone. A face with no such producer is not declared ahead of its implementer: declaration and implementer land in one runnable change (§7.2.7 says which). No current behaviour is replaced by a blanket refusal.
- **M2 — map applied.** Every file of the card's map is at its target path and name, split as the map says, with its symbols renamed; tables, lanes and operations are the card's; the module's own cuts of appendix B (edges where it is the **consumer**) are made. `X M2` completes **X's own implementations**: the ports X implements for lower declarers were bound at `X M1` (the "Replaced at" column of §7.2.7) and are finished here on X's final paths. Bindings that X's declared faces receive from an **upper** implementer `I` stay until `I M1`, which replaces them; `X M2` neither waits for nor removes them.
- **M3 — closed.** X's own `modules` debt (as consumer) and `names` debt are zero **over X's own map**; its `#module` and zone are written (§7.4.6); the card's acceptance holds. M3 checks X's remainder, never the disappearance of old directories that later waves still own (the threads card is the case in point: `harness/` and `thread/` keep native and external files until those waves).
- **N — narrowed.** X's entries are narrowed to `contract/` and its declared assembly, CLI and testing entries (a tightening through `enforce_rule`). This needs every **incoming consumer** `C` — every module that imports X under the target registry **or** under the reconciled current territory, the edges that will disappear (doors, fixtures, cuts of appendix B) included — to have passed `C M2`, because narrowing earlier turns a consumer's unmoved imports into new violations.

**Tracked tasks besides the four milestones** (each a real task in the generated graph):
- **`invocation K5a`** — K5a in `invocation`'s current code (`read_operations`, `Tagma-Contract`, `Tagma-Outcome`, aliases and tombstones, answer versions, the canonical identities of renamed operations). Waits on `platform M1`.
- **`X W2a`** for the six store owners (§7.2.4) — waits on `platform M1` and `projects M1`.
- **`D4`** — the thread split **with its runtime readiness** (§7.2.4): one change, before admission. Waits on `thread-record M1` and every `X W2a`.
- **`composition start`** (review D3) — `composition/start.ts` created and called from today's runtime (`http/runtime.ts` → `harness/Stack.ts`), so the transitional bindings of §7.2.7 have one installation point from the first module wave. At this early milestone it imports only platform's contribution contract and takes the old layers as arguments, never imports a future module's directory; each later `M1` contributes its declared faces when it creates that module. Waits on `platform M1`.
- **`landing preservation`** (review C2) — landing's keyed preservation publication (intent, witness, receipt) raised early in `landing/`, so `worktrees M1` binds the archive to the real port. Waits on `platform M1`, `projects M1`, `settings M1`, `thread-record M1`, `workspace M1`, `graph M1`, `change-record M1` — landing's registry dependencies without `worktrees` and `enforcement`: today's archive commits leftover work without a rule judgement (`working/WorktreeFinishing.ts` L552–592), so the keyed publication needs none; a judgement certificate, if section 3's E4 gives the preservation commit one, joins it at `landing M1` without changing the port.
- **`D9 E8`** — the mixed-load measurement after `perf E5`, `native-harness M3` and `external-harnesses M3`; D9 establishes inline bounds and worker count, then G5 follows its measured fork (§3.13.13).\n- **`perf E5`** — section 3 §3.13.13's E5, **one source change** (accepted decision [[9c085c6c]]): the executor kit and heavy-slot arbiter (platform), the authoritative records and tombstones and `inherit_rev` (threads' contract), the touched-set triggers and `block.*_rev` (graph), the kernel's keyed `transition`/`control`/`prepareBirth`/`birth`/`prepare`/`transitionIn` port with every consumer (Tagma, the workflow members), `thread.fold_rev` in both chains, and every journal append of every thread through the lane. Waits on `threads M1`, `native-harness M1`, `external-harnesses M1` and `graph M1`.

**Start rules, as edges** (the generator writes exactly these):
1. `X M1` waits-on `D M1` for every registry dependency `D` of X — **contract readiness**.
2. `X M1` waits-on `X W2a` for the six store owners.
3. `X M2` waits-on `X M1`.
4. **K5a:** `X M2` waits-on `invocation K5a` for every X whose map publishes a renamed operation, changes an answer or retires a typed route (K2): `projects`, `settings`, `providers`, `workspace`, `graph`, `installation`, `change-record`, `mcp`, `artifacts`, `executions`, `enforcement`, `performance`, `worktrees`, `landing`, `sandbox`, `threads`, `native-harness`, `external-harnesses`, and the doors `http`, `socket`, `cli`.
5. **The settings remainder:** `settings M2` waits-on `K M1` for every key owner `K` of `protocol/settings.ts` (7.5.3's key table: `graph`, `threads`, `native-harness`, `external-harnesses`, `mcp`, `performance`, `worktrees`, `enforcement`, `executions`, `power`). A key owner's `M1` waits only on `settings M1`, so this never blocks it.
6. **The old assembly:** `composition M2`, which deletes `Stack`, `http/runtime.ts` and every transitional binding, waits-on `X M2` of **every** other module, the doors included.
7. `thread-record M2` waits-on `D4` (review A3: no two-schema `M2` — the final map, the `thread_record` table and its view merge only after the data is there); `thread-record M3` follows `M2`.
8. `X M3` waits-on `X M2`.
9. `X N` waits-on `X M3` and on `C M2` for every incoming consumer `C ≠ X` (rule of N above). `composition N` therefore waits on `composition M3`, which waits on `composition M2`, which waits on every `M2` — the indirect dependency, with no self-edge. `composition M1` only dissolves the old assembly; the bindings were installed from `composition start`.
10. `projects M1` waits-on `composition start`; `worktrees M1` waits-on `landing preservation`; `threads M2`, `native-harness M2` and `external-harnesses M2` wait-on `perf E5`.
11. **The generated socket RPC:** `socket M2`, which generates `socket/rpc.ts` from the manifests, waits-on the `M2` of every owner that registers a feed or an act operation there: `threads`, `native-harness` (the act operations of 7.5.20), `providers`, `power`, `executions` (the feeds `accounts.subscribe`, `awake.subscribe`, `pace.subscribe` and the terminal and command feeds), and `graph`, `workspace`, `change-record`, `worktrees` (their feeds) — reviews D1, D2.
12. A dependent never waits for a dependency's `M2`, `M3` or `N` except by rules 4–6, 10 and 11.

Consequence, stated so nobody expects otherwise: because the doors and `composition` consume nearly every module, narrowing is the last pass of the whole plan.

The registry's dependency levels, without `platform` and `composition`, give the earliest possible order:

| Level | Modules | Depend on (registry, beyond `platform`) |
|---|---|---|
| 0 | `platform` | — |
| 1 | `projects` | — |
| 2 | `settings`; `thread-record` | projects; projects |
| 3 | `providers`; `workspace`; `power`; `mcp` | settings; projects, thread-record, settings; settings; projects, settings |
| 4 | `graph`; `change-record` | projects, settings, workspace; projects, settings, thread-record, workspace |
| 5 | `catalogs` | graph |
| 6 | `installation` | projects, settings, graph, providers, catalogs |
| 7 | `artifacts`; `executions` | installation; projects, settings, thread-record, workspace, installation, power |
| 8 | `enforcement`; `performance`; `worktrees`; `sandbox` | …, change-record, executions, installation; executions; …, change-record, executions; …, change-record, executions, installation |
| 9 | `landing` | projects, settings, thread-record, workspace, graph, change-record, enforcement, worktrees |
| 10 | `threads` | …, providers, graph, change-record, executions, worktrees, landing, sandbox |
| 11 | `native-harness`; `external-harnesses` | …, threads |
| 12 | `invocation` | …, threads, native-harness, external-harnesses |
| 13 | `http`, `socket`, `cli` | invocation |

### 7.2.3 The waves

Section 1 §1.11's groups stand; the start rules above only let a module inside a group open as soon as its own dependencies allow. The column "May open after M1 of" is the `M1 waits-on` edge set of §7.2.2. "Carries" names the steps of sections 2–5 that land inside the wave.

| Group | Module (level) | May open after M1 of | Carries | Runs beside |
|---|---|---|---|---|
| **W0** | `platform` (0) | P0 running; P1, P4, P5 standing | D0 (credential move first, typed stores and units, write sets, durability classes, key references, `durable` kit, snapshots, writer telemetry); E0 (`packages/held`, git kit lanes, OS lock, ceilings, `held-resources` and `blocking-calls` at gate); K0 (declaration fields, failure classes); N2 for its map, including `Actor.foreign` → `Actor.session` and `TerminalActor`'s replacement type `ActorRef` (the arm rename is earlier than section 5 §5.4.8 places it, which is safe because the type is in-memory only; the commit queue keeps reading its old lines until `enforcement`'s wave) | nothing: every module depends on it |
| **W1** | `projects` (1) | platform | D6's registration part (C2 project birth with graph, removal holds, registry participant); K2 for its routes | — |
| | `settings` (2) | projects | D6's settings part (settings owns `setting`, the managed-write hook slot, registry participant) | `thread-record` |
| | `providers` (3) | settings | D6's `default_account` cut from `thread_owner_settings`; D0's credential file already moved; K2 for accounts and auth routes | `workspace`, `power`, `mcp` |
| **W2** | store steps of `workspace`, `executions`, `sandbox`, `threads`, `native-harness`, `external-harnesses` | platform, projects (the moved tables keep their references to `project`) | the tables of D4 leave `db/` into each module's `store/` (no other file of those modules moves yet) | W1 |
| | `thread-record` (2) | projects | its contract and the `thread_record_facts` read model over today's rows (M1), then **D4** once the store steps stand (§7.2.4) | `settings`, `providers` |
| **W3** | `workspace` (3) | projects, thread-record, settings | D1's watcher and checkout reads; E1 | `providers`, `power`, `mcp` |
| | `graph` (4) | projects, settings, workspace | D1, D2 (graph store, graph acts), E2, E5, the rest of D6 (catalog requests; graph's registry participant) | `change-record` |
| | `catalogs` (5) | graph | section 9's shipped content as arguments | — |
| | `installation` (6) | projects, settings, graph, providers, catalogs | registry file, restore coordinator, `vacuum_database`, budget inputs (D8's volume figures) | — |
| **W4** | `change-record` (4) | projects, settings, thread-record, workspace | the prepared change and its lease; discharge on workspace's HEAD event | `graph` |
| | `power`, `mcp` (3) | settings (mcp also projects) | — | W1–W3 |
| | `artifacts` (7) | installation | — | `executions` |
| | `executions` (7) | projects, settings, thread-record, workspace, installation, power | D7 (host wire range, carried codec); the host environment backend; `CommandOwner` → `CommandSubject`, `ViewLeaseId`, `HostRequestKey`; the `'foreign'` custody literal → `'other'` | `artifacts` |
| **W5** | `enforcement`, `performance`, `worktrees`, `sandbox` (8) | as the level table | E4 (lanes, judgement certificates); K4 (`check_rules` whole in enforcement, after change-record's prepared change and K5a); the archive intent; guests below threads | each other |
| | `landing` (9) | …, enforcement, worktrees | E4's landing intents, receipts, tails, merge claim, `MergeNotice`, preservation landing, merge receipts | — |
| **W6** | `threads` (10) | …, landing, sandbox | first the `packages/agent` cut (thread catalog and runtime ports; the kernel loses its hidden native default, and `composition` supplies today's runner explicitly through `Harness` until `native-harness M1` — §7.2.4, §7.2.7; section 6 versions it); the `Harness` port and registry; the journal and its rollout lane (D3's lane part, E3); `thread_mandate`; D6's `approval_preference` | — |
| | `native-harness`, `external-harnesses` (11) | threads (and invocation K5a before their `M2`) | D3's folds, E6; the `ThreadExecution` port (declared here, implemented by `invocation`) with `afterEdit`; the native context actions `compact` and `refresh_thread_instructions`; D6's `model_preference`; K6 (`set_thread_model`); vendors under `external-harnesses/vendors/` | each other |
| **W7** | `invocation` (12) | …, native-harness, external-harnesses | K1 (one admission, lifetimes, verdict at every door); the `Actor` arm is already `session` since W0 (platform card) | — |
| | `http`, `socket`, `cli` (13); `composition` | invocation | K2's remaining routes, K3, K5b; `Stack` and `http/runtime.ts` dissolved; generated routes | each other |

**Steps that span waves, and where each stands:**
- **K5a** (read_operations, aliases, tombstones, answer versions) lands **before the first typed route retires** — at W1, with `projects`, in `invocation`'s current code. Every K2 after it relies on it.
- **D8** (budgets) lands per owner inside each wave (each owner declares its shelves); its floor path and the reserve file stand with W0's `durable` kit.
- **D9 / E8** (the mixed load on the lowest machine class) run after `perf E5` and W6, when the harness split stands; D9 establishes the inline bounds and worker count under accepted [[9c085c6c]] §3.13.13, and G5's measured fork decides any subsequent removal at the producer or lower threshold.
- **N3** rides D4 and D6. **N4** rides K5a and K5b.
- **The floor rule's one question** ([[f49f228f]]: remove the emptied entries and the rule) is asked after every module's `N` and the package and app tasks, when `modules` covers every path.

### 7.2.4 Cross-module work that is no single module's wave

| Work | Task owner | Waits on | Content |
|---|---|---|---|
| **W2a store steps** | one task per module (`workspace`, `executions`, `sandbox`, `threads`, `native-harness`, `external-harnesses`) | platform M1, projects M1 | Each module creates its directory with `store/` only and receives the definitions of its tables from `db/thread.ts`, `db/schema.ts`, `db/commandRules.ts`, `db/terminals.ts`, `db/sandbox.ts` and the assignment tables (section 2 appendix A, amended). No behaviour moves. Importers are rewritten in the same change. |
| **D4, the thread split** | `thread-record`'s wave task, with the six store steps as participants | thread-record M1; all W2a store steps | The one machine-chain migration of section 2 §2.4.4 as amended by section 1 §1.13: `thread_record`, `thread_mandate`, the native `thread`, `external_session`, the journal and lane re-keyed, legacy runs cut, shared tables re-pointed, the whole-store foreign-key check. **Runtime-ready in the same change, before admission, in the current paths** (W6 later only relocates working code): the record's reads and writes and the thread catalog and mandate reads that `harness/ThreadStore.ts` serves today switch to `thread_record` and `thread_mandate`; the **external** birth and session code — `harness/HarnessBirths.ts` `create`, `adopt`, `spawn` (L65–177: today they insert a native `thread` row with `provider: 'external'` and attach the facet to `thread`) and `harness/HarnessSessionStore.ts` `readIn`, `change` (L47–81: it updates `thread.harness` and `thread.status`) — switch to `thread_record` plus `external_session`, **never recreating a native row for an external thread**; the rollout participants (`harness/ThreadRollouts.ts`, `files/ThreadRolloutSync.ts`) read the re-keyed journal; the run ledger's adapter and the external session store publish the phase. The migration and these code changes are one merge; a server of this build runs the migration at boot before admission, and no build reads the old shapes after it. |
| **D6, the `thread_owner_settings` cut** | `providers` (W1) for `default_account`; `threads` (W6) for `approval_preference`; `native-harness` (W6) for `model_preference` | — | Two migrations: W1 moves `default_accounts` out into `default_account` (the column is dropped); W6 cuts the rest and drops the table (section 5 N3). **W1 switches the live code with its migration, before the column goes** (review A1): the two current paths that read and write the column — `thread/ThreadOwnerSettingsStore.ts` `modelSelection` (L39–65, which returns `account` from `defaultAccounts`) and `saveModelSelection` (L145–207), called from `harness/AccountDefaults.ts` L145–149, L205–215, L225–231 — read and write `DefaultAccounts` (providers) in the same change, at their current paths; W6 only moves that working code. |
| **The `packages/agent` cut** | `threads M1` | platform M1 | Section 1 §1.2 and section 6 P2: the collaboration kit's thread catalog and runtime ports. (The storage port's change — `ThreadStorePort`'s `updateAtomically`, `updateWithLifecycleLock` and `…InTransaction` replaced by the keyed `transition`, `control`, `prepareBirth`, `birth`, `prepare`, `transitionIn` with §3.13.7.5's outcomes, every kernel consumer converted in one source change — is §3.13.15's amendment to section 6 and lands with `perf E5`, not here.) **The kernel's hidden native default goes in the same change that makes the runtime port required** (`ThreadEnvelopes.ts` L245–269 today delivers through the native runner unless a participant owns the recipient). `threads` fills both ports at `threads M1` through `Harness`; the native `Harness` binding of §7.2.7 is today's runner, supplied **explicitly** by `composition`, until `native-harness M1`. the workflow members compose the native runner explicitly in P2's commit. Versioned by section 6. |
| **`composition start`** | `composition`'s task (early part) | platform M1 | `composition/start.ts` with the binding table of §7.2.7, called once before admission from today's `http/runtime.ts`/`Stack.ts`; each declarer's `M1` adds its rows there (review D3) |
| **`landing preservation`** | `landing`'s task (early part) | platform, projects, settings, thread-record, workspace, graph, change-record M1 | the keyed preservation publication — intent, witness, receipt and their rows in `landing/store/` — that worktrees' archive binds at `worktrees M1` (review C2) |
| **Section 3 §3.13 ([[9c085c6c]], accepted)** | E1, E2, E4 in `graph`'s wave (E2 with section 2's graph-chain migration: `name_use`, the `source(ref, kind)` index, `absorption`, `measure_pending`); E3 in `change-record`'s (measurement flights, the recording queue and its reader barrier, W12); E4 also in `native-harness`'s (W13); **E5 as the task `perf E5`** | as §7.2.2 | E5 is one source change: the executor kit and heavy-slot arbiter (platform); the authoritative records `thread_run.applied_seq`, `applied_digest`, `start_digest`, `thread_inbox.request_digest`, `thread_call`, `spent_call_key`, `spent_epoch`, the tombstones in `delete_thread`'s unit and `inherit_rev` (their contract is threads', §3.13.10; the `thread_run` columns sit on native-harness' table); graph's touched-set triggers and `block.text_rev`, `proj_rev`, `child_rev`; the kernel port below; `thread.fold_rev` and its triggers in Tagma's chain; every journal append of every thread through threads' lane |
| **K5a** | `invocation`'s task (early part) | platform M1 | as above, including the canonical identities and aliases section 5 decides (`graph_overview` → `read_overview`, `ready_tasks` → `list_ready_tasks`, `checkout_*` → `*_checkout`): one canonical id, the old id an alias resolving to it |
| **D9 / E8** | the measurement task of section 2 | `perf E5`, `native-harness M3`, `external-harnesses M3` | the mixed load: D9 establishes inline bounds and worker count; G5's comparison decides producer removal or a lower class threshold, never a speculative fold-family split ([[9c085c6c]] §3.13.13) |
| **Floor rule removal** | the operator's question | every module's `N` and the package and app tasks | section 1 §1.7 |

### 7.2.5 Many builders at once

- **One worktree per wave**, created through `create_worktree` (an authorized operation), merged at `M1`, `M2`, `M3` and `N`, so a dependent reads a merged contract, not a branch. How many wave worktrees stand at once is a storage and admission question; it is not the number of active CPU workers.
- **Concurrency limits apply where they measure.** The six-worker fan-out rule [[8925d705]] bounds concurrent execution fan-out — parallel commands, job pools, containers, worker spawns — inside a task; each wave task declares the parallelism it uses and stays inside that bound. It does not bound the product: Tagma's target of 10–20 concurrent agent sessions stands, and several builder sessions in several worktrees are sessions, not workers.
- **A mixed file is cut by the first wave that needs a part of it.** That wave moves its part out, rewrites the part's importers, and leaves the rest in place; a later wave finds its part already gone or still there, never half-moved. The primary owner's wave moves whatever remains (§7.4.4).
- **Disjoint maps.** Each current file has one primary owner and appears in other cards only as a named part (§7.6.1 is the reconciled table).
- **Overlapping edits are coordinated, never won.** When two waves change the same region of a file, the second builder reads the current region and its authorship (`read_changes` for the path), keeps both writers' work by meaning, and asks the other writer one concrete question about the lines in conflict; the rest of its work continues. No rule lets a receiver or an owner overwrite a peer's lines, and indivisible changes stay in one commit.
- **Import rewrites** in other modules' files are mechanical and allowed in any wave; they never change behaviour. A rewrite that needs a behaviour change is a question to the card's designer.
- **A wave that stalls** leaves its remaining violations as debt, still owned by its child tasks (section 5 §5.10 q16). Its dependents are not blocked past its `M1`.

### 7.2.6 What waits on the operator

- The **floor rule's** one question, when `modules` covers every path.
- **Moving an enforced rule** out of a zone that dissolves (section 8 §8.7): a separate approval per rule, in the wave that moves it.
- Nothing else: the start rule, the maps and the debt are this section's and the waves'.

### 7.2.7 Transitional bindings — every mandatory face an early `M1` needs

**Where bindings are installed** (review D3): the task `composition start` (§7.2.2) creates `composition/start.ts` before `projects M1` and has today's runtime call it — `http/runtime.ts` (L472 builds the stack through `harness/Stack.ts`) invokes `start.ts` once, before admission, to install every row of this table as its declarer's `M1` lands. The early file takes old layers as arguments through platform's neutral contribution contract; it does not import the directories of modules that do not yet exist. `composition M1` later only dissolves the old assembly into the modules' layers.

A face declared by a module whose implementer opens later is bound at `start` to the old producer named here, with the semantics the face promises, until the named replacement milestone binds the real implementation. `composition` installs each binding (its `start.ts`), and `composition M2` deletes whatever is left (rule 6 of §7.2.2). "Composition binds an adapter" is not the contract; this table is. Paths are the baseline's; each wave's delta review confirms them.

| Face (declarer → implementer) | Declared at | Old producer bound meanwhile | Semantics the binding must keep | Installed | Replaced at |
|---|---|---|---|---|---|
| **`RemovalHold`** (projects → graph, threads) | `projects M1` | the live-knowledge and standing-thread checks in `graph/projects/Projects.ts`' remainder (graph's part, still at that path after W1) | refuses a project removal inside the removal's machine unit, before any row is deleted; each filler's refusal is named | `projects M1` | `graph M1` (live knowledge); `threads M1` (standing threads) |
| **`ManagedWrite`** for `graph.catalogs` (settings → graph) | `settings M1` | the catalog-writer path of `land` in `graph/core/Settings.ts`' remainder (graph's part, still at that path) | the key's write and the owner's reaction (catalog installation) commit in one unit; a refused reaction refuses the write | `settings M1` | `graph M1` |
| **`EnvironmentBackend`** (workspace → executions host, sandbox guest) | `workspace M1` | `workspaces/HostEnvironment.ts` (executions' territory, still at its path) and the guest provider reached today through `working/WorkingOwners.ts` | acquire and release per environment with its lease and failure classes; a failed acquire leaves no binding | `workspace M1` | `executions M1` (host); `sandbox M1` (guest) |
| **`RootPublished`** (workspace → enforcement) | `workspace M1` | none needed: today's commit-hook installation during worktree creation (`enforcement/commitHooks.ts`, called by the creation path) stays in place; the hook has no filler until enforcement binds | every root that gets hooks today still gets them; no root loses them in between | — | `enforcement M1`, which binds the filler **and removes the creation-path call in the same change** |
| **Setting key declarations** (settings' manifest argument ← every key owner) | `settings M1` | the old declarations `SETTING_KEYS` and sections of `protocol/settings.ts` L1794–1884 (settings' remainder), for every key whose owner has not contributed yet (review A2) | `read_settings` answers today's catalog; every existing key reads and writes; nothing refuses `unknown-setting` | `settings M1` | each owner's `M1` replaces its group; `settings M2` deletes the temporary source |
| **`PaceDoor`** (power → executions) | `power M1` | today's host producer: `terminals/terminalsLayer.ts` L380 hands `executions.pace` to `holdAgentPace` (`power/AgentPace.ts` L49–60) (review C1) | answers the pace the host **applied**, never the one asked for; a host that cannot answer reports that, as today — the port is never left unbound | `power M1` | `executions M1` |
| **`HeldTaskLabels`** (change-record → graph) | `change-record M1` | today's `heldTasks` (`graph/projects/holders.ts` L47–80, L82–106) (review B3) | every `read_changes` row carries the tasks of its holders, for any path read | `change-record M1` | `graph M1` (bound directly if graph's `M1` came first) |
| **`PreservationCommit`** (worktrees → landing) | `worktrees M1` | **no old producer**: today's archive commits with `stageAt`/`commitAt` and no key, witness or receipt (`working/WorktreeFinishing.ts` L552–592). The real keyed publication is raised first by the task `landing preservation` (review C2) | intent, witness and receipt keyed by the archive intent; a restarted archive answers by its key; an archive whose preservation did not commit refuses | `worktrees M1`, bound to `landing preservation` | — (already real) |
| **Thread catalog and runtime ports** (`packages/agent` → threads) | P2, in `threads M1` | **no hidden default in the kernel:** P2 removes the native fallback of `ThreadEnvelopes.ts` L245–269 in the same change that makes the runtime port required; `threads` fills both ports at `threads M1` by dispatching through `Harness`, whose native binding is the next row | delivery reaches exactly the runner the thread's harness names; workflow members compose the native runner explicitly | `threads M1` | — (threads is the implementer) |
| **`Harness.born`** (threads → native-harness, external-harnesses) | `threads M1` | native: the kernel's `AgentHarness.createThread` path used by `harness/ThreadActs.ts` L236–238; external: `harness/HarnessBirths.ts` `create`, `adopt`, `spawn` — both already run inside the caller's unit | writes the harness's rows in the **birth unit** (C2b), so no reader sees a thread its harness does not know; an unknown harness id refuses typed | `threads M1` | `native-harness M1`; `external-harnesses M1` |
| **`Harness.folded`**, **`Harness.record`** on the common lane (threads → both harnesses; from `perf E5`, `folded` receives the fold the native transition prepared, [[9c085c6c]] §3.13.15) | `threads M1` | native: the fold projection in the append unit and the carry, eviction and rehydrate of the fold family (`files/ThreadRolloutSync.ts` L277–467, `harness/ThreadRollouts.ts`, `files/ThreadEviction.ts` — native parts at their old paths); external: `harness/HarnessSessionStore.ts` (the session row the record carries) | `folded` inside the journal's append unit; `record` inside the lane's export, rest and wake units; rest only after a synced export (section 2 §2.4.7) | `threads M1` | `native-harness M1`; `external-harnesses M1` |
| **`Harness.retract`** with the inbox take-back (`NoticeTakeBack`: executions → threads; threads → harness) | `threads M1` | native: `harness/commandSignalSend.ts` L38–46 (the kernel's `retractSignal`, which runs the caller's work inside its unit); external: acknowledgment of the inbox item only — today withdraws nothing more for a CLI | C2b: the inbox acknowledgment and the harness's durable withdrawal commit in the command's unit; the in-memory queue clears after commit | `threads M1` | `native-harness M1`; `external-harnesses M1` |
| **`Harness.quiet`** — the admission lease (threads → both harnesses; used by change-record's carrier admission and sandbox's `ReadStillness`) | declaration **and** implementers together: no old producer is an atomic lease (today's checks are `holdLanding` in `harness/submitWork.ts` L167–170 and the guest stillness read in `harness/sandbox/guestImports.ts` L80–90) | the consumers keep **today's checks, unchanged**, through `change-record M1` and `sandbox M1`; the carrier-admission and `ReadStillness` ports are bound to those checks | today's behaviour, no weaker and no stronger, until the lease exists | `change-record M1`, `sandbox M1` | the lease (acquired atomically with the no-run check, released on every outcome, refusing when quiet cannot be proved) lands **in one change** with both harnesses' implementations and the two consumers' switch: at the later of `native-harness M1` and `external-harnesses M1` |
| **`ThreadExecution`** (native-harness → invocation) | `native-harness M1` | `operations/nativeTools.ts` (already invocation's territory, at its old path) | tool calls run under the run's own grant through the one call door; `afterEdit` reaches the trigger dispatcher; before `start` no native run is admitted | `native-harness M1` | `invocation M1` (`nativeDoor.ts`) |
| **Carrier admission**, **`ReadStillness`**, **`NoticeTakeBack`** (lower declarers → threads) | `change-record M1`, `sandbox M1`, `executions M1` | today's code paths at their old locations: `holdLanding`; the guest stillness read; `commandNoticeTakeBack` | as the face's row in section 1 §1.4.3 | the declarer's `M1` | `threads M1` (quiet-based ones: as the `Harness.quiet` row) |
| **`MergeNotice`** (landing → threads) | **at `threads M1`, jointly** (review C3): the declaration in landing, threads' implementation and landing's merge settlement switching to it are one change | none: until that step the old path stays working and nothing is declared — the post-merge `WORKTREE_ENTRY` note (`working/WorktreeFinishing.ts` L421–460, `harness/WorktreeNotes.ts` L73–118) | from the joint step: the note lands in the requesting thread's inbox in the unit that writes the merge receipt (C2b) | `threads M1` | — |

## 7.3 The card template

Every card has these parts, in this order.

| Part | What it holds | Source |
|---|---|---|
| **1. Ownership** | the §1.3 sentence; the module name and directory; the glossary words it owns (section 5 §5.4.1) | section 1 §1.3; section 5 |
| **2. Wave** | group, level, `M1` waits-on (M1 of…), incoming consumers its `N` waits on, runs beside, the D/E/K/N steps it carries | §7.2 |
| **3. Offers** | `contract/wire` (browser-safe types, schemas, operation declarations); `contract/service` (services, ports it declares, hooks it declares); manifest contributions; events it publishes | section 1 §1.4 |
| **4. Needs** | each registry relation from this module, with its pattern; the ports it implements and hooks it fills, bound at `start` | `spec-01v10-relations.mjs` |
| **5. Tables** | the tables it owns, their store and recovery, and the migrations of this wave | section 2 appendix A as amended by section 1 §1.13; section 5 §5.4.6 |
| **6. Lanes, resources, passes** | ranks it declares or uses, passes it declares, lifetimes it contributes | section 3; section 4 lifetimes |
| **7. Operations** | operations it owns, renames by section 5 §5.4.6, typed routes it turns into operations (K2), CLI verbs it owns | section 4; section 1 §1.6.3 |
| **8. Target file map** | (a) every file whose primary owner it is → target path, or its split into named files with the concepts each takes; (b) every part it receives from another module's mixed file; (c) exported symbols renamed, old → new; (d) what leaves to other owners, including territory corrections | section 1 territory; section 5 rules |
| **9. Debt retired** | the `modules` edges of appendix B whose consumer is this module (and door edges into it, which other waves cut); the `names` entries of its files | P4, P5 snapshots |
| **10. Graph work** | section 8 §8.7 for this module: `#module`, zones re-hung, claims rewritten or re-anchored, tasks it absorbs or must not break | section 8 |
| **11. Acceptance** | what proves `M3` (and, where the card says, `M1` runnable and `N`) | this card |
| **12. Risks** | what can go wrong, and what the builder does then | this card |

## 7.4 Rules every card applies

### 7.4.1 Paths and form

- A module lives in `apps/tagma/server/src/<module>/` in kebab-case (section 5 §5.4.2), with section 1 §1.7's form: `contract/wire/`, `contract/service/`, `<module>.ts` (assembly surface: ordered layers and the manifest), `cli.ts` (verb descriptors, when the module owns verbs), and internal files grouped by **concept** in subdirectories — never by technical layer. `store/` is a concept here (the module's tables and their queries), because section 2 gives each module its own store file set.
- `contract/` files **define** what they export; nothing is re-exported (rule 8183e6ef). A service's tag and its faces type live in `contract/service/<concept>.ts`; its layer lives in the internal file that implements it.
- A path in a map is relative to `apps/tagma/server/src/`.

### 7.4.2 Names

- Section 5's F and S rules are read against every target path and symbol; a gate rule a map would break (F1, F2, F3, F4's ratchet, S1–S5, S7 (a)) is corrected before the wave opens.
- The rules are **signals**: a map chooses the fix by meaning — a rename or a move when the file holds one subject, a split only along named subjects (section 5 R1). A card never splits a file to meet a line count or an export count; where it splits, it names the subjects.
- **F3 is read against every target, not only against today's names.** v3 renamed the targets whose one plural word names a domain collection over 200 lines (`vocabulary/tags.ts`, `blocks/edges.ts`, `work/amendments.ts`, `store/terminals.ts`, `store/commands.ts`, `store/intents.ts`, `rows/threads.ts`, `voice/threads.ts`, `installs/hooks.ts`, `mcp/pools.ts`, `record/holders.ts`, `threadFiles/patches.ts` → the names in the maps). The syntactic scan (`control/f3scan.mjs` over the maps' line ranges — a signal, not a measurement of the final files) finds **eighteen** more. Each is resolved here, before P5; none is left to a builder or the operator:

| # | Target (module) | Est. lines | One subject the file holds | Resolution |
|---|---|---:|---|---|
| 1 | `workspace/checkouts/rows.ts` (workspace) | 377 | the live checkout rows: held rows, reads, follows, marks and their hold, linger and watch lifecycle (`CheckoutRows`) | **exclusion**: under `checkouts/`, "rows" is the checkout rows the class is named for |
| 2 | `graph/sources/checks.ts` (graph) | 233 | readying, `verify`, `unverify` of a claim against its sources | **rename** `sources/verification.ts` — the contract is verification, "checks" said nothing |
| 3 | `graph/orientation/briefs.ts` (graph) | 369 | the three briefs — review, spec-writing, work — one builder over one source set | **exclusion**: under `orientation/`, the file is exactly the brief kinds `read_brief` and `read_review_brief` answer |
| 4 | `graph/work/proposals/verdicts.ts` (graph) | 278 | accepting, rejecting and upholding a proposal | **exclusion**: under `proposals/`, the three verdicts of `#proposal` |
| 5, 6 | `graph/contract/wire/operations/reads.ts`, `writes.ts` (graph) | 334, 228 | the declarations of graph's read operations; of its block-write operations | **exclusion**: under `operations/`, each file declares one kind of operation; the kind is the honest stem |
| 7 | `change-record/record/reads.ts` | 328 | reads of the change record (history, versions, held rows, thread and project reads) | **exclusion**: under `record/`, the record's reads beside `record/write.ts` |
| 8 | `change-record/threadFiles/rows.ts` | 249 | the live thread-file list: hold, subscribe, read, marks, cycles | **exclusion**: under `threadFiles/`, the list's rows |
| 9, 10 | `executions/terminals/reads.ts`, `stops.ts` | 386, 260 | a terminal's reads (request keys, inventory, disposition, bytes, screens); its stops (feeds, processes, ports, signal, stops) | **exclusion**: under `terminals/`, one side of a terminal's lifecycle each, beside `start.ts`, `input.ts`, `custody.ts` |
| 11, 12 | `executions/worlds/shell/stops.ts`, `results.ts` | 240, 222 | a shell command's cancellation and deadline moves; its results | **exclusion**: under `worlds/shell/`, beside `start.ts` and `launch.ts` |
| 13 | `threads/birth/acts.ts` | 244 | the birth acts (delegation, child spawn, type, placement, host admission) | **exclusion**: under `birth/`, the acts of birth; `birth/birth.ts` would be F1 |
| 14, 15 | `threads/operations/reads.ts`, `acts.ts` | 325, 222 | the bodies of threads' read operations; of its act operations | **exclusion**: under `operations/`, as 5 |
| 16 | `native-harness/transcript/rows.ts` | 356 | fold and restore of transcript rows, row writes, cached reads, page taking | **exclusion**: under `transcript/`, the transcript's stored rows beside `fold.ts` |
| 17 | `native-harness/evidence/faces.ts` | 349 | the `ThreadEvidence` service: its faces and their implementation (snapshot, held, composition, query) | **rename** `evidence/threadEvidence.ts` — named for its contract, as the review asked of a vague `faces.ts` |
| 18 | `external-harnesses/hooks/writes.ts` | 205 | the hooks that record a CLI's writes: base shadowing, pending flush, tool-use hooks | **exclusion**: under `hooks/`, the write hooks beside `events.ts`, `session.ts`, `permission.ts` |

  **Amendment to section 5 this requires (not made here):** F3 keeps measuring every one-word plural stem over 200 lines; its gate excludes only the **exact paths** a card lists with one subject and the reason its directory makes the short stem honest — today the sixteen exclusions above. No global exemption for `reads`, `rows` or `acts`, and F3 does not move to watch. A new path that trips F3 needs its own card entry.
- Section 5's exemptions apply as it states them: F1 exempts the assembly surface `<module>/<module>.ts`; a reserved word such as `Harness` outside its owners' regions is a watch signal (S7 (b)), so `HarnessId` and `NATIVE_HARNESS` stand in `platform` as the glossary places them.
- A boundary symbol keeps its domain word (`ThreadTitleStore`, not `TitleStore`); a private symbol drops it (section 5 §5.4.5).
- Frozen data keeps its spelling even when its symbol is renamed: table and column names outside section 5 §5.4.6, refusal codes, settings key ids, permission subject strings, environment variables and headers. The map says so wherever a symbol and its data differ.

### 7.4.3 Tests follow their subject

A test file (`*.test.ts`, `*.itest.ts`, `*.stest.ts`, `*.bench.ts`) moves with the file it tests and takes the same new stem. A test over a file that splits moves with the part whose behaviour it asserts; one that asserts several parts is split with them. Test files are not listed in the maps; the builder applies this rule and `modules` measures the result (tests read their own module, neighbours' `contract/` and declared test entries — section 1 rule 1).

### 7.4.4 Mixed files

- A file section 1 splits across modules is listed in full in its **primary owner's** card (8a) and, for each part that leaves, in the **receiving** card (8b), with the same part names.
- The first wave that needs a part moves it (§7.2.5). Importers of the moved part are rewritten in that change.
- Until the primary owner's wave, the remainder stays at its old path and counts with its primary owner in `modules` (section 1 §1.7: one physical owner per file).

### 7.4.5 Debt

- `modules` debt is `<consumer> → <target>` with its file set. A card lists the edges whose consumer is its module; the wave retires them by the replacement appendix B names, and a site the replacement cannot remove is a question to section 1, never debt left standing.
- `names` debt is per path and rule (F), or per symbol and file (S). A card lists its files' entries; F4 entries carry the line count, and a file in debt may shrink, never grow.

### 7.4.6 Graph work, in every wave

Section 8 §8.7, with this section's order and with the graph's real operations. A path move and a block move are different acts. `reanchor_path` changes **addresses**: given a file or directory path it relocates every source at or below it — symbol sources on that file included — to one destination; given `path#Symbol` it relocates or renames that one symbol source. It keeps claims and stamps, it does not move a block to a new owner, and it cannot divide one whole-file source between two targets.

1. **Before any file moves (the start of `M1`), the source plan.** For each file of the card's map the builder lists the blocks with a source on it (`read_owners` for the path; `search_blocks` with `path`) and writes, per source, where it goes:
   - a **file that moves whole** to one target: one `reanchor_path` from the old path to the new moves all its sources, symbol sources included;
   - a **file that is split**: first one `reanchor_path` per symbol source (`old#Symbol` → `new#NewName`), each to the file its symbol goes to; only then its **whole-file** sources, which no path operation can divide — the builder re-reads each claim, decides which part of the code its sentence is about, adds that source with `anchor_block` on the new file and removes the old one with `unanchor_block`. A claim whose sentence spans several of the new files keeps **one claim with several narrow sources** when it states one indivisible guarantee (section 8 §8.8: one invariant may need several sources and owners); only a claim that bundles **independent** assertions is rewritten into one claim per assertion, and only then is the original superseded (`supersede_block`). A source move alone is never a supersession: addresses change with `reanchor_path`, sources change owner with `anchor_block`'s `fromId`, blocks change parent with `update_block` — three separate supported acts. A whole-path `reanchor_path` is never used on a split file: it would carry every remaining symbol source to one destination;
   - a **directory source** follows `reanchor_path` of the directory when the directory moves whole, and is re-decided like a whole-file source when it splits;
   - an **ownership change** between blocks — an area's file source going to the new zone's area — is `anchor_block` with `fromId` naming the block it comes off, one act, never a detach and a reattach.
2. **Moving a claim to its owner** is a separate act: `update_block` with the new parent, after the new zone's area exists. A rule at watch or gate never leaves its region this way; that goes through `enforce_rule` with the operator's approval (§7.2.6).
3. **Verification.** Every claim whose source moved is read against its new source; `verify_block` only after that reading, and a claim that no longer holds is withdrawn with `unverify_block` and rewritten, never re-stamped. `run_doctor` aimed at the moved paths closes the dead-source findings a move would otherwise leave.
4. **At `M2`**, the claims whose sentences name old places, retired words or moved owners are rewritten from the code; the affected claims outside the zone are checked, not the whole graph.
5. **At `M3`**, the module's `#module` is written under the server product [[05042d40]] with its `dir` source and `depends-on` edges per the registry; `zone-cutter` and `zone-builder` build the zone from the card and the code; `zone-reviewer` reads it; layer areas that moved in dissolve by meaning; the zone's findings are zero; the `modules` snapshot is updated through `enforce_rule`.
6. Open tasks under the areas the wave dissolves are either closed into the wave task (when the wave writes what they asked) or re-hung under the new zone with `update_block`.

## 7.5 Server module cards, in wave order

### 7.5.1 `platform`

**1. Ownership.** Mechanics with no subject of their own: stores and units, each store's writer register, the git kit with its hook, commit and index lanes, durable files, capacity and tickets, clocks and deadline arithmetic, the declaration machinery, and the neutral vocabulary (section 1 §1.3). Directory `platform/`. Glossary words owned: **session** (`SessionRef`, the writer register), **unit**, **principal** (the term), **actor** (the type), **operation** (the declaration machinery), `HarnessId` (a brand without a list).

**2. Wave.** W0, level 0. Opens when P0 (release N) runs and P1, P4, P5 stand (§7.2.1). Carries D0, E0, K0 and N2 for this map. Every other module waits on its M1; nothing runs beside it.

**3. Offers.**
- `contract/wire/`:
  - `actor.ts` — `Actor` (the resolved call) with arms `operator`, `thread`, `session` (`Actor.thread.ownerId` → `principalId`, its credential role), `ActorRef` (the stored identity: `operator`, `thread(threadId, projectId)`, `session(SessionRef, projectId)`; it grants nothing), `ThreadReach`, `OPERATOR_PRINCIPAL`, `signerPrincipal`;
  - `session.ts` — `SessionRef`, `HarnessId` (brand), `NATIVE_HARNESS`, `sessionToken`, `parseSessionToken`, `sessionName`, `SESSION_HEADER`, `MCP_SESSION_HEADER`, `MCP_KEY_VARIABLE`;
  - `ids.ts` — `spokenId`; K0 adds `OperationId` (brand), `CallKey`, `RequestKey` (section 5 §5.4.3);
  - `refusal.ts` — `GateRefusal`, `Unblock`, `cursorRefusal`, `RefusalBody`, `faultBody`, `refusalSchema`, `missingSchema`, and the field-refusal machinery whose code sets the owners contribute;
  - `caller.ts` — `Caller` (actor and file reach only), `FileReach`;
  - `consent.ts` — `Consent`, `CallConsent`;
  - `provenance.ts` — `ProcessProvenance` (which running process and build recorded something: `startedAt`, `revision {head, dirty}`), received from `protocol/source.ts`, and `provenanceLine` (← `sourceLine`, its neutral text); its producer is installation's `measureProvenance`.
- `contract/service/`:
  - `store.ts` — `Store`, `MachineStore`, `StoreFailure`, `StoreError`, `StoreTransactionOptions`, `StoreDb`, `SchemaState`, `MigrationChainError`, `WRITER_BUDGET_MS`; D0 adds the typed `GraphStore`, write sets and durability classes;
  - `units.ts` — `Unit`, `WriteUnit`, `Units`, `UnitsFaces`;
  - `writers.ts` — `WriterRegister` and its faces, `SignedSession`, `SignedCall` (K1 makes the last two required call-lifetime services, section 4 "no ambient optionals");
  - `git.ts` — `ownGit`, `ownGitLayer`, `runGit`, `runGitBytes`, `actingGit`, `OwnGitError`; E0 adds the hook lane (rank 280), the commit lane (290), `index.settle` (300) and compare-and-set publication;
  - `credentials.ts` — the grant, act header, shell key and identity-environment functions;
  - E0 adds `capacity.ts` (the `Capacity` ledger instance over `packages/held`), `deadlines.ts` (§3.12 derivations), `lock.ts` (the data-directory lock kit); D0 adds `durable.ts` (the durable-file kit). At `perf E5` (accepted [[9c085c6c]] §3.13.7.4, §3.13.10), platform adds the executor kit, the pure-job contract, the SHA-256 state format and **one heavy-slot arbiter** for pure jobs and impure executions; its slots alternate between waiting kinds without changing the other memory and handle reservations. No CPU token is held outside a running pure job.
- **The declaration machinery and voice primitives are public contract, so they live in `contract/`** (v3 put them in `platform/declarations/` and `platform/voice/`, which `N`'s contract-only entries would then have refused): declaration **shapes** in `contract/wire/` — `operation.ts` (K0 grows it into `operation()`, `arms()`, `pair()`, `feed()`, `endpoint()`, `manifest()` and the trigger shape), `section.ts`, `setting.ts`, `pageFamily.ts`, `plainText.ts` (neutral rendering), `voiceAnswer.ts` (the answer envelope every voice uses); declaration **runtime** in `contract/service/` — `body.ts` (`bind`, `saying`), `subjects.ts` (a body's read subjects), `verb.ts` (the verb contract). Each file defines what it exports; the implementation behind them (`platform/store/`, `platform/git/`) stays internal, and there is no re-export and no blanket entry.
- **Other entries, as section 1 declares them:** `platform.ts` (assembly, for `composition`); `platform/testing/` (the testing entry: fixture scope, roots, spawn — test files only).
- **Hooks declared:** none. **Ports declared:** none. **Events published:** none.
- **Manifest contributions:** its layers (store, units, writer register, own git, grant key initialisation) and the failure classes.

**4. Needs.** Nothing: `platform` imports no module (section 1 rule 11). What it names of a domain comes in as an **argument**: the database path and seed directory (installation), the migration reports (each migration's owner), the identity variables an external harness adds (external-harnesses), a vendor's session prefix (external-harnesses).

**5. Tables.** `session` (the writer register) in every store, and the migration ledger (`__drizzle_migrations`, the graph chain's ledger). D0's credential move lands first: `console_key.key_value` leaves for the credential file under `secure_delete` before any snapshot exists (section 2 D0); the file and its format are `providers`', and the move is D0's because it must precede the first snapshot.

**6. Lanes, resources, passes.** Ranks 280 (hook section), 290 (commit section), 300 (index section) as mechanisms; the store's single writer permit and its writer window; the data-directory lock. Passes: shelves, reclaim, vacuum steps, WAL checkpoint and snapshot cleanup are declared with `installation` (section 3 pass table); `platform` supplies the `Passes` and `Capacity` mechanisms. Lifetimes: none of its own; its services are installation-lifetime contributions.

**7. Operations.** None. `vacuum_database` is `installation`'s (section 1 §1.8).

**8. Target file map.**

*(a) Files whose primary owner is `platform`* (27 files, 2,350 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `db/Store.ts` | 558 | split: `platform/contract/service/store.ts` (the `Store` and `MachineStore` tags, their faces, `StoreFailure`, `StoreError`, `StoreTransactionOptions`, `SchemaState`, `WRITER_BUDGET_MS`); `platform/store/open.ts` (`storeLayer`, `open`, `Store.layer` and `Store.seeded` as functions `storeLayer(options)`, `seededStoreLayer(options)`); `platform/store/chain.ts` (`chain`, `shippedChain`, `shippedMigration`, `pendingMigrations`, `MigrationChainError`, the foreign-key reach check: `schemaReading`, `reached`, `referrers`, `schemaState`); `platform/store/transaction.ts` (`storeTransaction`, `WriterTimings`, `writerVerdict`, `reportIfOverBudget`, the span helpers); `platform/store/vacuum.ts` (`sizeOf`, `vacuumStore`, `stepVacuum`, `freeSpaceOf`, `IncrementalVacuum`, and the types `StoreSize`, `Vacuum`, `VacuumVerdict`, `VacuumDeclined`); `platform/store/seed.ts` (`seedDatabase`) | `Db` → `StoreDb` (S2). `databasePath()` and `seedDirectory()` become arguments of `storeLayer` (cut `platform → installation`). `LANDED_REPORTS` becomes an argument: a registry of reports keyed by migration name, each contributed by the migration's owner (cut `platform → executions`) |
| `db/Units.ts` | 39 | `platform/contract/service/units.ts` (`Unit`, `WriteUnit`, `UnitsFaces`, `Units`) and `platform/store/units.ts` (`unitsLayer`, `ConnectionUnits`) | the `'thread'` label hard-coded in `write` becomes the caller's operation label |
| `db/binds.ts` | 5 | `platform/store/binds.ts` | — |
| `graph/projects/Sessions.ts` | 108 | split: `platform/contract/service/writers.ts` (`WriterRegister` ← `Sessions`, `WriterRegisterFaces` ← `SessionsFaces`, `SessionRow`, `SignedSession`, `SignedCall`) and `platform/store/writers.ts` (the `session` table from `db/schema.ts`, `writerRegisterLayer` ← `sessionsLayer`: `resolve`, `signedId`, `idOf`, `byId`, `writerOf`, `named`, `all`); `inProject` → `graph` (the projection of the writers who left journal entries or project settings in a project) | the register's `resolve` requires `GraphTransaction` today; it takes the store's `WriteUnit` instead, so the register serves every store (section 2 §2.4.1). `Writer` (from `protocol/rows.ts`, graph) becomes `platform`'s `WriterRef` in `writers.ts` (cut `platform → graph`) |
| `files/ShadowGit.ts` | 398 | split: `platform/contract/service/git.ts` (`runGit`, `runGitBytes`, `actingGit`, `gitVerb`, `OwnGitError` ← `ShadowGitError`, the scrubbed environment `gitEnvironment` and `RunGitOptions`) and `platform/git/unmerged.ts` (`unmergedPaths`, `unmergedReader`); `ShadowGit`, `ShadowCommit`, `ShadowMerge`, `FORKS_FILE`, `gitIdentity` → `graph` | Section 1's split: general invocation and readings → platform; the shadow repository and the graph's author identity → graph. The scrubbed environment is **Tagma's own git**, not shadow policy: a landing keeps using the user's git and hooks (Astra C12) and chooses `ownGit` only where section 3 says so |
| `protocol/ownGit.ts` | 16 | `platform/contract/service/git.ts` (with the part above) | one concept: Tagma's own git invocation |
| `protocol/caller.ts` | 64 | split: `platform/contract/wire/actor.ts` (`Actor`, `ThreadReach`, `signerPrincipal` ← `signerOwner`); `platform/contract/wire/caller.ts` (`Caller` without its `workspace` field, `FileReach` ← `FileScope`); `Workspace` → `workspace` (`WorkingPlace`, carried by the workspace lifetime, cut `platform → workspace`); `Lens`, `NameReach`, `ProjectCall` → `graph`; `ProjectRef` → `projects` | `Actor.foreign` → `Actor.session` and `ownerId` → `principalId` land **here**, in W0, as a type rename with every reader; `ActorRef` is added beside `Actor` (section 5 §5.4.3). Section 5 §5.4.8 places the arm rename with `invocation`; the type is in-memory only, so the earlier wave is safe and saves a second pass. `TerminalActor` is replaced by `ActorRef` in `executions`' and `enforcement`'s waves, where the commit queue's decoder reads both formats |
| `protocol/consent.ts` | 11 | `platform/contract/wire/consent.ts` | `CallConsent` becomes a required call-lifetime service in K1 |
| `protocol/session.ts` | 32 | split: `platform/contract/wire/session.ts` (`SessionRef`, `NATIVE_HARNESS`, `sessionToken`, `parseSessionToken`, `sessionName`, `SESSION_HEADER`, `MCP_SESSION_HEADER`, `MCP_KEY_VARIABLE`, and `HarnessId` received from `protocol/harnesses.ts`); `THREAD_REACH_ANY_SUBJECT`, `THREAD_PROJECT_FOREIGN_SUBJECT` → `threads` (as `THREAD_PROJECT_OTHER_SUBJECT`, its string `'thread://project/foreign'` frozen: permission rules store it) | `sessionName` takes the vendor's prefix as an argument; the lookup in `HARNESSES` moves to `external-harnesses` (cut `platform → external-harnesses`). `spokenId` is received from `protocol/identity.ts` into `ids.ts` (cut `platform → graph`) |
| `protocol/grant.ts` | 110 | `platform/contract/service/credentials.ts` | Renames: `sessionEnvironment` → `grantEnvironment`, `harnessEnvironment` → `sessionTokenEnvironment`, `HARNESS_SESSION_VARIABLE` → `SESSION_TOKEN_VARIABLE` (value `'TAGMA_HARNESS_SESSION'` frozen); S7 keeps `Harness` out of `platform`. `identityVariables(extra)` takes the external harnesses' variables as an argument (cut `platform → external-harnesses`). F5 (21 exports) is a signal: the file holds one subject, the credentials a call carries, so it moves whole |
| `protocol/refusal.ts` | 125 | `platform/contract/wire/refusal.ts` | `GateRefusal`, `Unblock`, `cursorRefusal`, `RefusalBody`, `faultBody`, `refusalSchema`, `missingSchema` stay. The code unions leave: `CallerRefusal`, `OpenRefusal`, `ReferenceRefusal` → `graph` (serving and name resolution); `FloorRefusal` → `graph` as `ServingRefusal` (section 5, S7); `unknown-project`, `ambiguous-project`, `project-required` → `projects`. `FIELD_REFUSAL`/`isFieldRefusal` become a platform mechanism (`fieldRefusals(codes)`) fed by the owners' code sets through the manifest |
| `protocol/operations/shape.ts` | 44 | `platform/contract/wire/operation.ts` | `Operation`, `OperationConfirmation`, `OperationPresentation`; the `threadId` schema → `thread-record` (`ThreadId`). K0 grows this file into section 4's declaration |
| `operations/bound.ts` | 52 | `platform/contract/service/body.ts` | `bind`, `saying`, `bindRunningOtherActs`, `Bound`, `BoundBody`; `InputOf`, `RefusalOf`, `Refused`, `EveryRefusal` stop reading `OPERATIONS` (cut `platform → composition`) and read the declaration they are given (section 4 `pair()`) |
| `operations/callerReads.ts` | 24 | `platform/contract/service/subjects.ts` | `callerPath`, `readSubject`, `callerReads`, `documentReads`: the read subjects a body declares for a path its caller names |
| `protocol/section.ts` | 14 | `platform/contract/wire/section.ts` | `SectionContext.op` takes `OperationId` from `platform/contract/wire/ids.ts` (cut `platform → composition`) |
| `protocol/pageFamilies.ts` | 241 | split: `platform/contract/wire/pageFamily.ts` (the server's family constructor `family`, built on `@runlith/paging`, which owns the mechanism — `pageCeiling`, `pageLimit`, cursors; today's `ceilingOf` and `limitOf` are replaced by them, section 6 §6.2.3); each family to its owner: `BLOCKS`, `TASKS`, `REFLECTIONS`, `PROPOSALS`, `FINDINGS`, `GAUGES`, `EVENTS` → `graph`; `CHECKOUT_HISTORY`, `COMMIT_FILES` → `workspace`; `THREADS` → `threads`; `COMMANDS`, `TERMINALS` → `executions`; `CALLS`, `COMPACTION_CHOICES` → `native-harness`; `CHANGES` → `change-record`; `WORKTREES`, `ARCHIVED_WORKTREES`, `WORKTREE_CLEANUP` → `worktrees`; `INSPECTIONS`, `VIOLATIONS` → `enforcement`; `PAGE_FAMILIES` → derived in `composition` from the manifests | cut `platform → enforcement` (`PROGRAM_MESSAGE_CHARS` goes with `INSPECTIONS`) and `platform → graph` (`CHECK_REMEDY` goes with its family) |
| `protocol/numbers.ts` | 36 | dissolves (eighteen unrelated figures, each read by one owner), each constant to its reader's owner: `DEFAULT_PORT`, `SURFACE_DEV_PORT`, `ARTIFACT_PORT` → `installation`; `PALETTE_PAGE_SIZE` → `http` (the app's palette route); `SEARCH_TERM_MIN`, `EVENTS_PAGE_SIZE`, `OWNER_SPREAD_AREAS`, `ZONE_PAGE_BUDGET`, `TOUCH_INLINE_BUDGET`, `SESSION_START_BYTES`, `PROMPT_CONTEXT_CHARS`, `SESSION_START_MAP_CHARS`, `MODEL_OUTLINE_ROWS`, `UNCOVERED_NAMED_PATHS` → `graph`; `AGENT_LIST_ROW_BYTES`, `AGENT_LIST_MAX_ROWS`, `AGENT_LIST_ROWS` → `threads` (the agent library); `CURSOR_SESSION_START_CHARS` → `external-harnesses` (the Cursor vendor) | the F5 signal goes with it |
| `projection/plain.ts` | 41 | `platform/contract/wire/plainText.ts` | `plainLines`, `plainInline`: neutral rendering every operation voice may use |
| `protocol/projectionRefusal.ts` | 1 | → `threads` (territory correction, §7.6): `ThreadProjectionRefusalReason` types `thread_rollout_refusal`, which is the rollout lane's | — |
| `protocol/subjectBinding.ts` | 4 | → `workspace` (territory correction): `encodeBinding` is read only by `protocol/worktreeSubjects.ts` and `harness/WorkingSubjects.ts`, both working bindings | — |
| `protocol/database.ts` | 42 | split: the types `StoreSize`, `Vacuum`, `VacuumVerdict`, `VacuumDeclined` → `platform/store/vacuum.ts`; `storeSizeSchema`, `vacuumSchema`, `vacuumRefusal` → `installation` (the wire and refusal text of `vacuum_database`) | territory correction for the second part |
| `projection/database.ts` | 12 | → `installation` (territory correction): `vacuumText` is `vacuum_database`'s voice | — |
| `operations/currentProject.ts` | 23 | → `graph` (territory correction): `CurrentProject` answers the call's served project (`ProjectCall`, vocabulary and lens), and refuses with graph's caller codes | — |
| `FixtureScope.ts` | 235 | `platform/testing/scope.ts` (the testing entry) | test support with no subject of its own; fixtures that assemble several modules go to `composition`'s test world (section 6) |
| `fixtureRoots.ts` | 29 | `platform/testing/roots.ts` | — |
| `fixtureSpawn.ts` | 32 | `platform/testing/spawn.ts` | — |
| `fixtureHosts.ts` | 27 | → `executions` as `executions/fixtures/hosts.ts` (territory correction): it finds and ends execution-host processes (`host/host.js`) | — |

*(b) Parts received from other modules' files:*

| From (primary owner) | Part | Target |
|---|---|---|
| `db/schema.ts` (graph) | the `session` table | `platform/store/writers.ts` |
| `protocol/harnesses.ts` (external-harnesses) | `HarnessId` | `platform/contract/wire/session.ts` |
| `protocol/identity.ts` (graph) | `spokenId` | `platform/contract/wire/ids.ts` |
| `protocol/rows.ts` (graph) | `Writer` | `platform/contract/service/writers.ts` as `WriterRef` |
| `ai/Models.ts` (providers) | `CREDENTIAL_OWNER` | `platform/contract/wire/actor.ts` as `OPERATOR_PRINCIPAL` (value `'operator'` frozen) |
| `protocol/settings.ts` (settings) | the declaration shape: `SettingKey`, `SettingValue`, `key` (exported as `settingKey`), `listKey` (as `settingListKey`), `SETTING_SCOPES`, `SettingScope`, `SETTABLE_SCOPES`, `SettableScope`, `SETTING_MERGES`, `SettingMerge`, `SETTING_UNITS`, `SettingUnit`, `SettingChoice`, `SettingColorSlot`, `SettingColorGroup`, `SETTING_CATALOGS`, `SettingCatalog`, `SettingFieldCondition`, `SettingField`, `SettingControl`, `SettingLayerAnswerOf`, `SettingLayersOf`, `SettingLayerAnswer`, `SettingLayers`, and the section *type* | `platform/contract/wire/setting.ts` |
| `protocol/toolResult.ts` (native-harness) | the envelope every operation's voice answers with: `ToolRefusal` → `VoiceRefusal`, `ToolAck` → `VoiceAck` | `platform/contract/wire/voiceAnswer.ts` (confirmed or corrected by native-harness's card) |
| `protocol/source.ts` (graph; split by §7.6) | `SourceCut`, `sourceCutSchema` (L3–8) | `platform/contract/wire/provenance.ts` as `ProcessProvenance`, `processProvenanceSchema` |
| `protocol/operations/index.ts` (composition) | the `OperationId` brand (not the literal union) | `platform/contract/wire/ids.ts` (K0/K3) |
| `cli/args.ts`, `cli/help.ts`, `cli/exit.ts`, `cli/door.ts`, `cli/invocation.ts`, `cli/operatorOutput.ts` (cli) | the verb contract of section 1 §1.6.3: argument helpers, help notes, exit class by outcome (`refusalOf`, `failureLines`, `exitCodeOf`, `refuse`, `end`), `print`, the remote call (`ask`, `askQuietly`, `here`), `Invocation`, `CurrentInvocation` | `platform/contract/service/verb.ts`; `cli`'s card keeps argv parsing, the process and the renderers that name a domain (`renderProjects`, `renderStanding`, …, each to its owner) |

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `graph/core/refusal.ts` (graph, corrected in §7.6): `refusing` → `platform/contract/service/body.ts` (beside `bind`, which folds failures with it)
- from `graph/projects/git.ts` (graph, corrected in §7.6): the tolerant git readings → `platform/git/readings.ts` (exposed through `contract/service/git.ts`)
- from `protocol/text.ts` (graph, corrected in §7.6): `trimmed` → `platform/contract/wire/text.ts`
- from `thread/portCrossing.ts` (threads, corrected in §7.6): the store crossing helpers → `platform/store/crossing.ts` (exposed through `contract/service/store.ts`)

*(c) Symbols renamed:* `Db` → `StoreDb`; `Sessions` → `WriterRegister`; `SessionsFaces` → `WriterRegisterFaces`; `sessionsLayer` → `writerRegisterLayer`; `ShadowGitError` → `OwnGitError`; `FileScope` → `FileReach`; `signerOwner` → `signerPrincipal`; `Actor.thread.ownerId` → `principalId`; `Actor` arm `'foreign'` → `'session'`; new `ActorRef`; `sessionEnvironment` → `grantEnvironment`; `harnessEnvironment` → `sessionTokenEnvironment`; `HARNESS_SESSION_VARIABLE` → `SESSION_TOKEN_VARIABLE`; `CREDENTIAL_OWNER` → `OPERATOR_PRINCIPAL`; `key`/`listKey` → `settingKey`/`settingListKey`; `Store.layer`/`Store.seeded` → `storeLayer`/`seededStoreLayer`.

*(d) Leaves:* `inProject` (→ graph), the shadow repository and author identity (→ graph), the code unions of `refusal.ts` (→ graph, projects), the page families (→ owners), `numbers.ts`' constants (→ owners), the thread subjects (→ threads), and the territory corrections of (a).

**9. Debt retired.**
- `modules`: `platform → graph` (7 imports: `Sessions.ts` ×4, `caller.ts`, `pageFamilies.ts`, `session.ts`), `platform → composition` (2), `platform → external-harnesses` (2), `platform → installation` (1), `platform → executions` (1), `platform → workspace` (1), `platform → enforcement` (1) — all seven edges of appendix B whose consumer is `platform`, each by the replacement named in (a).
- `names`: `db/Store.ts` S2 (`Db`); `files/ShadowGit.ts` F5 (9); `protocol/caller.ts` S3 (`signerOwner`); `protocol/grant.ts` F5 (21); `protocol/numbers.ts` F5 (18); `protocol/pageFamilies.ts` F5 (23); `protocol/refusal.ts` S7 (`FloorRefusal`); `protocol/session.ts` F5 (9). The F5 entries are signals and carry no debt; the moves by subject clear them.

**10. Graph work.**
- Claims over the moved files are re-anchored at M1: the store's claims (`cda1524b`, `291cc685`, `a3275bf5`, `bc4abc66`, `0158f8ad`, `ff0d9d40`, `84a45e52`, `6c4aa89b`, `a982eabc`, `27b8077c`, `83f33643`, `a39fb820`, `bc69ab3c`, `86fb19e2`, `5f4406ef`, `e6b7e904`), the units claim (`d313b0c9`, `82c2a3bf`), the writer register's (`b95b93b8`, `91190f31`; `f4f690aa` goes to graph with `inProject`), the grant claims (`65dcd963`, `dd5927a7`), the caller claim (`980ae1cc`), the refusal claim (`affd77a8`).
- Areas that dissolve into this zone: [[9217020c]] "The database this server keeps everything in" (the store mechanics; its table-by-table claims go to each table's owner) and the neutral part of [[19aec648]] "The vocabulary every caller speaks" (actor, session, refusal, credentials; the rest of that area goes to each owner). The git-invocation claims of [[84e7cf4e]] "The graph as files a repository carries" come here; its shadow-repository claims stay with graph.
- Tasks: [[82167fbe]] and [[94983e4d]] (write the claims of the database / of the vocabulary) close into this wave's zone for the parts it writes; [[66fb4c59]] (a transaction past the writer budget leaves nothing durable) and [[2c4b12f0]] (caller-layer codes ride entry lists) stay open under the new zone and are not broken by the move.
- `#module` `platform` under [[05042d40]], `dir` `apps/tagma/server/src/platform`, no `depends-on`.

**11. Acceptance.**
1. `platform/` imports no other module's path (the `modules` rule and `names` S7 hold with zero debt for `platform`).
2. Every file of (a) is at its target or gone as (a) says; every part of (b) is here; no re-export exists.
3. D0 stands: the credential move ran before the first snapshot; typed `MachineStore`/`GraphStore` do not type-check as each other; every unit declares its write set and durability class; `Unit.run` refuses a statement outside its write set.
4. E0 stands: the hook, commit and index lanes pass their section 3 tests; `held-resources` and `blocking-calls` are at gate with first-run debt.
5. K0 stands: the declaration fields exist beside the old lists, and `answer-declared` and `operations-registered` are at gate.
6. Every claim anchored in a moved file is re-anchored, and the zone has no open findings.

**12. Risks.**
- **Everything imports `protocol/refusal.ts`, `db/Store.ts` and `db/Units.ts`.** M1 rewrites hundreds of importers. Do it as one mechanical change per moved file, with no behaviour edit in it, so review reads only paths.
- **The `0d2c66a9` rule** keeps `@runlith/agent-tools` out of the low floors; `callerReads.ts` imports `pathSubject` from `@runlith/agent-tools/workspace`. Either that door is added to the rule's allowed list through `enforce_rule` (a loosening, asked in the open), or `pathSubject` moves to `@runlith/agent/permissions`, which the rule allows. The builder asks before M1; the second is preferred.
- **Section 4's "no ambient optionals"** turns `SignedSession`, `SignedCall` and `CallConsent` into required services only in K1. Until then they stay `Context.Reference`s; the wave does not change their semantics.
- **The field-refusal table** is read by every operation's declaration, and its codes belong to `graph` and `projects`, which open later. `platform` keeps the table whole in `refusal.ts` until those waves pull their codes out. The codes are string literals, so no import measures this; it is a known breach of section 1 rule 11 (no domain list in `platform`), named here and in the `graph` and `projects` cards, and it ends at `graph`'s M1.

### 7.5.2 `projects`

**1. Ownership.** Which projects are registered on this machine, under what name and canonical address, and what refuses their removal (section 1 §1.3). Directory `projects/`. Glossary word owned: **project**.

**2. Wave.** W1, level 1. Opens after platform M1. Carries D6's registration part (projects' registry participant; project birth as C2 coordinated by `graph`), the removal-holds hook, and K2 for the `projects` routes. Runs beside the W2a store steps. `settings` and `thread-record` open at its M1.

**3. Offers.**
- `contract/wire/project.ts` — `ProjectId` (brand, section 5 §5.4.3), `ProjectRef` (`{id, name}`), the project row answer (`id`, `name`, `repoKey`, `rootPath`, `createdAt`, `global`), `GLOBAL_PROJECT`, the refusal codes `unknown-project`, `ambiguous-project`, `project-required`, `reserved-project`, `project-name`, `duplicate-name`, `duplicate-root`, `relative-root`, `missing-root`, `global-permanent`, `project-not-empty`.
- `contract/wire/operations.ts` — the operations of 7 below.
- `contract/service/registry.ts` — `Projects` (faces: `list`, `byId`, `resolve(ref | cwd)`, `global`, `register`, `setRoot`, `remove`, `registryVersion`) and `ProjectIdentity`.
- **Hook declared:** `RemovalHold` — `(project) => Effect<string | null>`: a holder names what still stands on the project, synchronously, before removal; a holder that cannot answer refuses, unreadable is never empty (section 1 §1.4.3). Contributors, bound at `start`: `workspace`, `graph`, `threads`.
- **Event published:** `registryChanged` (C3) — the counter `registryVersion` moves inside the writing unit; `installation` rewrites `registry.json` after it (section 1 §1.4.3), and a served copy compares against it (claim `a4b7b43b`).
- **Participant:** the registry export and import of `registrations`, called by `installation` in one machine unit (section 2 §2.4.9 as amended).
- **Manifest:** its operations, its CLI verb `projects`, its table.

**4. Needs.** `platform` only (service: machine store, units, key refs). Its birth is coordinated **above** it: `graph` writes the registration through `Projects.register(unit, …)` together with its own `project_serving` birth intent in one machine unit (C2), then the graph store's first unit (C4) — `projects` never calls graph.

**5. Tables.** `project` (machine store), registration columns only: `id`, `name` (unique), `repo_key` (unique identity), `root_path`, `global`, `created_at`. Owned since section 1 v10; the graph store keeps its copy, which is `graph`'s.
- **Migration of this wave (D6):** the serving-policy columns `strict_provenance`, `private`, `storage` leave `project` for a graph-owned row: `graph` reads and writes them, and registry restore gives them back through graph's participant (section 1 §1.13 "graph (its project policy)"). The table is `project_policy` (one row per project; owner `graph`; decided here, §7.7). Until graph's M1 the columns stay in `project` and only `graph`'s code writes them — a declared exception to one-owner-per-table that ends at graph's M1, recorded in both cards.
- `global` stays a registration fact: the cross-project graph is registered with the store (claim `7b624c80`).

**6. Lanes, resources, passes.** None of its own. Removal holds run under the caller's deadline and their own §3.12 ceiling; a holder past it is named in the answer. No pass: `registry.json`'s dump is `installation`'s.

**7. Operations.** The typed routes of `api/projects.ts` become operations (K2), named by section 5 §5.4.6, reviewed before the wave opens:

| Route today | Operation | Owner |
|---|---|---|
| `GET /api/projects` (`list`) | `list_projects` | projects |
| `GET /api/projects/current` (`current`) | `read_project` with `cwd` | projects (resolution); the served-graph facts it answers today → graph's `read_overview` |
| `POST /api/projects` (`add`) | `add_project` | projects, with graph coordinating the birth |
| `GET /api/projects/:ref` (`byRef`) | `read_project` | projects |
| `PATCH /api/projects/:ref/root` (`setRoot`) | `set_project_root` | projects |
| `DELETE /api/projects/:ref` (`remove`) | `remove_project` | projects |
| `PATCH /api/projects/:ref/setting` (`setSetting`) | `set_project_policy` | **graph** |
| `PATCH /api/projects/:ref/storage` (`setStorage`) | `set_project_storage` | **graph** |
| `GET /api/projects/:id/branches`, `…/roots` | `list_branches` (the served graph's branches, `ServedGraphs.branches`) and new **`list_root_blocks`** (the project's root blocks, `Selection.roots`: blocks with no parent) — both author-read in `http/handlers/projects.ts` L106–114; v3 sent them to worktrees and workspace, which was wrong | **graph** |

CLI verb `projects` (`cli/commands/projects.ts`): its `add`, `set-root`, `remove`, `list` subcommands are `projects`'; `set` and `storage` subcommands move to `graph`'s verb (section 1 §1.6.3).

**8. Target file map.**

*(a) Files whose primary owner is `projects`* (3 files, 992 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `graph/projects/Projects.ts` | 836 | split by subject — registration versus graph serving (F1, F3 and F4 point at it): **to `projects`:** `projects/contract/service/registry.ts` (`Projects` tag, `ProjectsFaces` narrowed to registration, `ProjectRelease` → the `projectRemoved` event); `projects/resolution.ts` (`list`, `byId`, `resolve`, `globalProject`, `sameOrInside`); `projects/registration.ts` (`register` ← the row part of `add`: `identify`, `assertIdentityFree`, `assertNotReserved`, the name rule, the insert; `setRoot`; the global project's row); `projects/removal.ts` (`remove`: the `RemovalHold` hook, `refuseUnmaking`, the row delete, `projectRemoved`); `projects/store/table.ts` (the `project` table, registration columns). **To `graph`:** the root block and catalog installation of a birth (`ensureGlobal`'s block part, `add`'s block part), `ensureVocabulary`, `servesFrom`, `zoneByPlace`, `scopeByPlace`, `relativePlace`, `placeOf`, `ownersOf`, `scope`, `lens`, `measureNotice`, `set` (policy), `setStorage`, `purgeProject`'s graph rows, `ForeignGraphs` (→ `OtherGraphs`, S7), `PROJECT_SETTING_CHECKS`, `GraphRole` | The removal today checks graph's live knowledge (`project-not-empty` over blocks, sources, edges, refs): that check becomes **graph's `RemovalHold`**, and the setting purge becomes **settings'** (section 1 cut `projects → settings`: "project removal is coordinated by graph, which purges settings through their owner"). `claims`/`releases` (the ad-hoc hold and release sets) become the `RemovalHold` hook and the `projectRemoved` event |
| `protocol/projects.ts` | 13 | split: `GLOBAL_PROJECT` → `projects/contract/wire/project.ts`; `PROJECT_SETTINGS`, `ProjectSetting`, `TAGMA_HOME`, `SERVES_FROM`, `ServesFrom`, `blocksRetiredKey` → `graph` (serving policy and storage) | — |
| `cli/commands/projects.ts` | 140 | `projects/cli/verb.ts` for `add`, `set-root`, `remove`, `list`, declared in `projects/cli.ts`; `set` and `storage` → `graph`'s verb | written against `platform/contract/service/verb.ts` (cut `projects → cli`) |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `db/schema.ts` (graph) | the `project` table, registration columns | `projects/store/table.ts` |
| `graph/projects/repo.ts` (graph) | `identifyProject`, `ProjectIdentity` (the repository key of a root) | `projects/identity.ts` — territory correction: section 1 did not list `repo.ts` as split; its checkout readings (`checkoutAt`, `checkoutsOf`, `RepoCheckout`, `RepoWorktree`) go to `workspace` |
| `protocol/caller.ts` (platform) | `ProjectRef` | `projects/contract/wire/project.ts` |
| `protocol/refusal.ts` (platform) | the codes `unknown-project`, `ambiguous-project`, `project-required` | `projects/contract/wire/project.ts`, contributed to the field-refusal machinery |

*(c) Symbols renamed:* `add` → `register` (the service face; the operation stays `add_project`); `ProjectRelease` → `projectRemoved` (event); `hold(claim)` → the `RemovalHold` hook. `Projects` keeps its name as the boundary service (F3 applies to the file, not the symbol).

*(d) Leaves:* everything listed "to `graph`" in (a); `repo.ts`' checkout readings to `workspace`. The graph remainder **stays at `graph/projects/Projects.ts`** after this wave: that file's owner becomes `graph` in the `modules` snapshot (an update through `enforce_rule`), and its `names` debt (F1, F3, S7, and F4 if still over 600 lines) transfers to graph's wave task, which names the remainder by its own card.

**9. Debt retired.**
- `modules`: `projects → graph` (17 imports, all in `Projects.ts` and `cli/commands/projects.ts`), `projects → settings` (2), `projects → cli` (3). Door edges into `projects` (`http → projects` 18, `socket → projects` 8, `cli → projects` 1) are cut by the doors' waves (section 4 K1/K2); this wave keeps their imports compiling by giving them `projects/contract/service/registry.ts`.
- `names`: `graph/projects/Projects.ts` F1, F3, F4 (836 lines), S7 (`ForeignGraphs`).

**10. Graph work.**
- [[fe468405]] "The projects a machine serves" splits: registration, resolution, identity and removal claims come here (`5a672d68`, `f4d9bf30`, `4ffefac8`, `95ac6f70`, `99a05b11`, `7b624c80`, `0855c80e`, `dedaf11e`, `a4b7b43b`, `9221a929`, `407bc0d4` — the last two rewritten: holds are now contributors of `RemovalHold`, and live knowledge is graph's hold); serving, scope, ownership and policy claims stay with graph (`1183b8af`, `7e936ee1`, `79f1380e`, `94729e2d`, `8657c978`, `9e3f9117`, `8e994084`, `0fad235e`, `c2e93dcb` — the last rewritten: the row and the root block land in one machine unit coordinated by graph).
- [[b1309732]] (write the claims of the projects a machine serves) closes into this wave's zone for registration.
- Open tasks [[fcf163d1]] (concurrent same-name registrations answer a store failure) and [[cd8ce735]] (removal leaves the `blocks-retired` marker) move with their code: the first here, the second to graph.
- `#module` `projects`, `dir` `apps/tagma/server/src/projects`, no `depends-on` beyond platform (`platform` edges are implicit in the snapshot's root rule).

**11. Acceptance.**
1. `projects/` imports only `platform`; `modules` and `names` hold with zero debt for it.
2. `add_project` writes the registration and graph's birth intent in one machine unit and answers as `projects.add` did; a failed birth takes the row back (claim `c2e93dcb`'s guarantee, now under graph's coordination).
3. `remove_project` refuses with `project-not-empty` naming every holder (graph's live knowledge, workspace's uses and assignments, threads), and an unreadable holder refuses.
4. Registry restore through `installation` rewrites registrations through `projects`' participant (after W3's installation M1; until then the old `importRegistry` keeps working).
5. The routes of 7 answer through generated `/api/op/<id>` endpoints, and the typed routes retire one release after their callers moved (K2), with K5a standing.

**12. Risks.**
- **The removal check is spread over three owners.** If `graph`'s hold is not yet bound at `start` (its wave is later), `remove_project` must refuse naming the unbound hook, never remove. The start-bound rule of section 1 §1.4.4 gives this; the builder writes the test.
- **The policy columns** stay in `project` until graph's M1 (5 above). Nothing in `projects` may read or write them in the meantime.
- **Many importers** (`http`, `socket`, every handler) read `Projects` for resolution. M1 gives them the narrowed service; the parts they read that moved to `graph` (`lens`, `scopeByPlace`, `ownersOf`) keep answering from `graph/projects/Projects.ts` until graph's wave moves them.

### 7.5.3 `settings`

**1. Ownership.** The value of every declared setting at every scope, how it resolves and who changed it; the keys are declared by the modules they configure (section 1 §1.3). Directory `settings/` (it exists: `settings/resolve.ts`). Glossary: **setting** is used in its one meaning; the module owns no other word.

**2. Wave.** W1, level 2. Opens after projects M1. Carries D6's settings part: `settings` owns the `setting` table, its resolution, revisions and write; the managed-write hook; the registry participant; the chain-preserving rename `agents.offered` → `agent.offered` is **not** this wave's (it is the key owner's, `threads`, section 5 §5.4.6). Runs beside `thread-record`. `providers`, `power`, `mcp` and every other key owner open at its M1.

**3. Offers.**
- `contract/wire/catalog.ts` — `SettingEntry`, `SettingRejection`, `SettingCatalogView` (the answer of `read_settings`), `SettingWriteRefusal` codes (`unknown-setting`, `setting-managed`, `setting-scope`, `setting-value`).
- `contract/wire/units.ts` — `unitsOf`, `scaleOf`, `rawOf`, `Scaled` (the app reads them).
- `contract/wire/operations.ts` — `read_settings`, `write_setting`, `write_setting_layer`, `settingScopeOf`.
- `contract/service/values.ts` — `Settings` (faces: `read`, `value`, `chain`, `live`, `held`, `changes`, `catalog`, `write`, `amend`), `SettingWrite`, `Resolved`.
- **Hook declared:** `ManagedWrite` — a key whose `control.kind` is `managed` is written only through the hook its declaring owner contributes (bound at `start`); without the hook bound, writing the key refuses (section 1 §1.4.3). The one contributor today is `graph` for `graph.catalogs`, which runs section 2 §2.4.9's request → activation → settle and writes the row through `settings`' store in the settle unit.
- **Event published:** `settingsChanged(keyId, scope, projectId)` (C3), after commit. Consumers apply their own keys; `graph` re-marks graph stores by fingerprint for `decides` keys.
- **Participant:** the registry export and import of setting values, called by `installation` in one machine unit.
- **Manifest argument received:** the key declarations and sections every owner contributes (section 4 §4.4.4 `settings`); `settings` builds `keysById` from that argument, never from a central list. **Until every owner contributes, `settings M1` assembles it with one temporary source** (review A2): the old declarations `SETTING_KEYS` and the sections of `protocol/settings.ts` (L1794–1884, settings' remainder), for every key whose owner has not yet contributed; each owner's `M1` replaces its group with its own contribution, and `settings M2` deletes the temporary source with the remainder (§7.2.2 rule 5, §7.2.7). `read_settings` and every write keep today's catalog throughout; no existing key refuses `unknown-setting` in between.

**4. Needs.** `platform` (units, the setting declaration shape, the writer register); `projects` (key reference: a project-scope value names a registered project). Settings imports no key owner: each key is declared by its module and reaches settings as an argument (cuts `settings → graph`, `settings → power`, `settings → providers`, `settings → catalogs`, `settings → composition`).

**5. Tables.** `setting` (machine store): `id`, `scope`, `project_id` → `project`, `key`, `value`, `declined`, `session_id` → the writer register, `updated_at`. D6 adds a revision per row for the managed write's compare-and-set (section 2 §2.4.9). Project removal purges the project's settings through `settings`' own method, called by the removal's coordinator (claim `37472139`'s guarantee, now through the owner).

**6. Lanes, resources, passes.** The live subscriptions (`live`, `held`, `changes`) are installation-lifetime fibers publishing after commit. The `catalogWrites` permit leaves with the managed write (it is `graph`'s: it orders catalog writes). No pass.

**7. Operations.** `read_settings`, `write_setting`, `write_setting_layer` (section 4 operation owners). Typed routes of `api/settings.ts`: `catalog` → `read_settings` (already the same answer); `write` → `write_setting`; `workspaceInventory`, `reload` and `compactionSummarizers` → `native-harness`: `reload` is **not** a settings reload — its handler (`http/handlers/settings.ts` L37–44) invalidates the native `WorkspaceSourceCache` for the caller's project and answers the walked skills and context files as `workspaceInventorySchema` (`api/settings.ts` L153–156), so it becomes native-harness's `reload_workspace_sources`, beside `read_workspace_sources` (`workspaceInventory`) and `read_compaction_summarizers`. Settings owns no reload operation.

**8. Target file map.**

*(a) Files whose primary owner is `settings`* (5 files, 2,797 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `graph/core/Settings.ts` | 548 | split by subject — the setting values and the graph's reactions to two keys (F3 points at the file's name): **to `settings`:** `settings/contract/service/values.ts` (`Settings` tag, `SettingsFaces`, `SettingWrite`, `SettingWriteRefusal`); `settings/store/rows.ts` (`layers`, `scopeRows`, `storedValue`, `valueLayerOf`, `layerOf`, `rowOf`, the `setting` upsert and delete); `settings/writes.ts` (`write`, `amend`, `gates`, the C1 unit of `land` without its graph parts, the `ManagedWrite` dispatch, the `setting-managed` refusal); `settings/live.ts` (`live`, `held`, `changes`, `publish`, `liveValues`, `holdings`: the `settingsChanged` event); `settings/catalog.ts` (`catalog`: sections, entries, rejections from the contributed declarations); `settings/settings.ts` (the assembly surface, `settingsLayer`). **To `graph`:** `CatalogGraph`, the `catalogWrites` permit, the catalog-writer path of `land` (installing the candidate before the unit and in it), the `decides` re-measure (`doctorSettingBlocks`, `GraphMeasure.remeasure`, `announce`), `vocabulary.publish(held)` and `CommitHooks` in `onCommit` | Section 1's split: rows, resolution, revisions and write → settings; the `graph.catalogs` write hook and the decided-settings reaction → graph. The settle's `setting` write for a managed key goes through `settings/store/rows.ts` inside graph's settle unit (section 2 §2.4.9 as amended) |
| `settings/resolve.ts` | 163 | `settings/resolution.ts` | `resolveSetting`, `resolveCatalog`, `SettingLayer`, `Resolved`, `merge`, `unique`. F2 is not broken today; the rename says what the file holds |
| `protocol/settings.ts` | 1,920 | split by subject (the F4 gate ratchet and the F5 signal point at it; the subjects are the declaration shape, the catalog answer, and each owner's keys): the **declaration shape** → `platform/contract/wire/setting.ts` (listed in the platform card); `SettingEntry`, `SettingRejection` → `settings/contract/wire/catalog.ts`; `SETTING_KEYS` → derived in `composition` from the manifests; `SETTING_SECTIONS` → one section per owner, each declared beside its keys; **each key to its owner**, by namespace (below): `graph`, `threads`, `native-harness`, `external-harnesses`, `mcp`, `performance`, `worktrees`, `enforcement`, `executions`, `power`; the remainder stays `settings`' until `settings M2` (§7.2.2 rule 5) | `performanceSpanFloorMicros` → `performanceSpanMinMicros` (S7; the key id `performance.spanFloorMicros` is data and stays) |
| `protocol/settingsReading.ts` | 50 | `settings/contract/wire/units.ts` | browser-safe |
| `protocol/operations/settings.ts` | 116 | `settings/contract/wire/operations.ts` | — |

*Keys of `protocol/settings.ts`, by owner* (each lands in the owner's `contract/wire/settings.ts` in its wave; until then it stays in `protocol/settings.ts`, whose remainder **stays settings' physical file, with its debt** — F4 gate (1,921) as owned debt that may only shrink — until every key has left):

| Owner | Keys (constant → id) |
|---|---|
| `graph` | `commentPolicy` (`writing.comments`), `mapBudget` (`orientation.mapBudget`), `graphCommit` (`graph.commit`), `graphCatalogs` (`graph.catalogs`, managed), sections `writing`, `orientation`, `graph` |
| `threads` | `subAgentDepth`, `delegation`, `birthApprovalMode` (`agent.subAgentDepth`, `agent.delegation`, `agent.approvalMode`), `agentsOffered` (`agents.offered` → `agent.offered` in the threads wave), `autoTitle`, `titleModel`, `titleReasoning`, `titleCharacters`, `idleProjectionDays` (`threads.*`) and the `AGENT_WORKTREES` choice set with `agentWorktrees` (`agent.worktrees`), section `threads` |
| `native-harness` | `keepWarm`, `keepWarmPings`, `toolOutputShare`, `compactionStrategy`, `compactionTrigger`, `compactionOverrides`, `compactionSummarizerRule`, `compactionSummarizers`, `checkoutWorld`, `checkoutMode`, `contextFilesEnabled`, `contextFileNames` (`agent.*`), the eight `skills.*` keys, `skillInventoryEntrySchema`, `workspaceInventorySchema`, section `agent`, `skills` |
| `external-harnesses` | `harnessTitle` (`threads.harnessTitle`: how an external harness's own title is adopted) |
| `mcp` | `mcpServers` (`mcp.servers`), section `mcp` |
| `performance` | `tracesMaxBytes`, `performanceStorageLimit`, `performancePendingLimit`, `performanceSpanFloorMicros`, `performanceKeepOneTraceIn`, `vitalsIntervalMs`, `metricsIntervalMs`, section `telemetry` |
| `worktrees` | `worktreeFolder`, `worktreeBranchPrefix`, `worktreeSetupCopy`, `worktreeSetupRun`, section `worktrees` |
| `enforcement` | `inspectionPrograms` (`enforcement.programs`), section `enforcement` |
| `executions` | the 40 `terminal.*` keys with their theme, colour, cursor, ligature, GPU, option-as-alt and shortcut types and defaults, `hostMemoryShare` (`host.memoryShare`), `commandDefaultMs` (`command.defaultMs`), sections `terminal`, `host`, `command` |
| `power` | `keepAwake`, `agentWork` (`power.*`), section `power` |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `db/schema.ts` (graph) | the `setting` table | `settings/store/table.ts` |
| `graph/projects/Projects.ts` (projects) | the project-scoped purge `db.delete(setting)…` of `purgeProject` | `settings/store/rows.ts` as `purgeProject(unit, projectId)`, called by removal's coordinator |

*(c) Symbols renamed:* `resolve.ts` → `resolution.ts` (file only); `performanceSpanFloorMicros` → `performanceSpanMinMicros`. `Settings` stays: it is the boundary service and the plural names the collection it owns.

*(d) Leaves:* the graph parts of `graph/core/Settings.ts` stay at that path as graph's remainder, its `names` debt (F3 if over 200 lines) transferred to graph's task; the keys to their owners as above.

**9. Debt retired.**
- `modules`: `settings → graph` (9), `settings → power` (1), `settings → providers` (1), `settings → catalogs` (1), `settings → composition` (1). Door edges `http → settings` (6) are the doors' cuts.
- `names`: `graph/core/Settings.ts` F3, F4 watch; `protocol/settings.ts` F4 gate (1,920), F5 (112), S7 (`performanceSpanFloorMicros`) — the F4 entry retires as the owners' waves pull their keys (F5 is a signal); `settings`' task owns them until the file is empty, then deletes it.

**10. Graph work.**
- [[ec2b42ac]] "How a setting is declared, and what its value resolves to" becomes `settings`' zone, less the declaration shape (→ `platform`) and the keys' meanings (→ each owner's zone). [[7e7eac3b]] (write its claims) closes into this wave's zone.
- The claims over `graph/core/Settings.ts` split by the same line as the code: the value, scope and managed-write refusal claims come here; the catalog activation and `decides` claims stay with graph.
- `#module` `settings`, `dir` `apps/tagma/server/src/settings`, `depends-on` `projects`.

**11. Acceptance.**
1. `settings/` imports only `platform` and `projects`' contract.
2. Writing a `decides` key is one durable C1 unit; `graph` re-marks through `settingsChanged`, and a missed event is caught at the store's next pass (section 2 §2.4.9).
3. Writing `graph.catalogs` without graph's hook bound refuses; with it bound, it behaves as section 2 §2.4.9 (request, activation, settle), and the settle writes the row through `settings`' store.
4. `read_settings` answers the same entries and rejections as before, built from the contributed declarations.
5. `settings` has zero `modules` and `names` debt; `protocol/settings.ts` is gone once every owner's M1 has passed.

**12. Risks.**
- **`protocol/settings.ts` is read by almost every module** and is 1,920 lines. It cannot move whole to `settings` (that would make `settings` own every owner's keys) nor leave in one change. Its remainder therefore stays **`settings`'** — one physical owner in `modules`, its F4 entry owned by `settings M2` — while each key owner pulls its keys at its **own `M1`** (which waits only on `settings M1`). **`settings M2` waits on the `M1` of every key owner** in the table above; only then does it delete the emptied file and retire the F4 entry. `settings M3` follows. No wave ever sees an ownerless shared file.
- **The managed write crosses two owners in one unit.** `settings` must expose a store method that runs inside a unit it did not open (`WriteUnit` given by graph's settle), or section 2's C2 breaks.
- **`SignedSession` gates agent writes** (`An agent writes … in its own project alone`). It keeps reading the platform reference until K1.

### 7.5.4 `providers`

**1. Ownership.** The operator's access to model providers: accounts, credentials, quotas, the default account per provider, and the catalog of models each serves (section 1 §1.3). Directory `providers/` (today's `ai/` dissolves into it). Glossary words owned: **provider**, **account**.

**2. Wave.** W1, level 3. Opens after settings M1. Carries D6's `default_account` cut (the `default_accounts` column leaves `thread_owner_settings`), K2 for the `accounts` and `auth` routes, and the credential file's owner code (its move ran in D0). Runs beside `workspace`, `power`, `mcp`.

**3. Offers.**
- `contract/wire/catalog.ts` — `MODEL_CATALOG`, `CONSOLE_PROVIDERS`, `ConsoleProviderId`, `isConsoleProvider`.
- `contract/wire/accounts.ts` — `QUOTA_PROVIDERS`, `QuotaProviderId`, `consoleKeyLabel`, `providerCacheLifetimeSchema`, `cacheLifetimesSchema`, `accountQuotaRowSchema`, `AccountQuotaRow`, `accountsFrameSchema`, `QuotaTable`.
- `contract/wire/operations.ts` — the operations of 7.
- `contract/service/access.ts` — `ModelAccess` (← `Models`: `request`, `account`, `capacity`, `cacheLifetime`, `compactionTrigger`, `modelId`), `DefaultAccountReader`.
- `contract/service/quota.ts` — `AccountQuota` tag and faces (`table`, `observe`, `refresh`, `changes`), `Spendability`, `spendability`, `signingAccount`, `callable`, `textModelOf`.
- `contract/service/accounts.ts` — `ProviderAccounts` faces (`of(provider)`), `StoredAccount`, `DefaultAccounts` (← the default-account part of `AccountDefaults`: `defaultAccount`, `saveDefaultAccount`, `adoptDefaultAccount`, with its own revision).
- **Participant:** in `set_thread_model` (F041), a C2 participant writing `default_account` only when `defaultAccount` is named (section 4 §4.4.7 as amended). In rollback, providers writes the console keys from its credential file into the snapshot copy in the column the previous binary reads (section 2 §2.10 step 2).
- **Event published:** `defaultAccountMoved(provider)` (today's `defaultMoved` callback).
- **Manifest:** its operations, its CLI verb `sign-in`, its tables, its rank-690 gates (`AccountQuota`, auth sign-in).

**4. Needs.** `platform` (units, the durable file kit, clocks); `settings` (service and event: provider preferences). Nothing above. `@runlith/llm` is a package it composes; `providers/` is kept out of the `0d2c66a9` rule's low-floor selection (it loads model clients), and no module in that selection may load `providers` at runtime.

**5. Tables.**
- `console_key` (machine store: id, label; the key value in the credential file since D0), `account_quota_reading` — from `db/consoleKeys.ts`, `db/accountQuotaReadings.ts`.
- `default_account` (new, section 5 §5.4.6): one row per principal and provider, `principal_id`, `provider`, `account`, `revision`. **Migration (D6, this wave):** fill from `thread_owner_settings.default_accounts` (JSON map per owner), then drop that column — **in the same change** `ThreadOwnerSettingsStore.modelSelection` (L39–65) and `saveModelSelection` (L145–207), with their callers in `harness/AccountDefaults.ts` (L145–149, L205–215, L225–231), read and write the account through `DefaultAccounts` at their current paths, so model selection keeps working after the drop (review A1); the remaining columns wait for `threads` and `native-harness` in W6 (§7.2.4).
- The credential file (not a table) is `providers`': format, versioning, 0600, cross-process lock (section 2 §2.4.1).

**6. Lanes, resources, passes.** Rank 690 gates `AccountQuota` and auth sign-in (section 3). Pass: **quota refresh** (background; source: the quota readings; triggers: an observation, a sign-in, a cadence) — today driven inside `AccountQuota`'s layer; it is declared as a pass in this wave (section 3 E7). Lifetime: `ModelAccess` and `AccountQuota` are installation-lifetime contributions (section 4 §4.4.2 as amended).

**7. Operations.** The typed routes become operations (K2), named by section 5 §5.4.6:

| Route today | Operation |
|---|---|
| `GET /api/accounts` (`read`) | `list_accounts` |
| `GET /api/accounts/cache-lifetime` | `read_cache_lifetimes` |
| `POST /api/accounts/refresh` | `refresh_accounts` |
| `PUT /api/accounts/default` | `set_default_account` |
| `GET /api/auth/status` | `read_sign_in` |
| `POST /api/auth/sign-in/begin`, `…/complete` | `begin_sign_in`, `complete_sign_in` |
| `GET /api/auth/discover`, `POST /api/auth/import` | `discover_accounts`, `import_accounts` |
| `DELETE /api/auth/accounts/:provider/:account` | `remove_account` |
| `PUT …/:account/label` | `rename_account` |
| `POST /api/auth/token/:provider` | `read_provider_token` |
| `PUT /api/auth/console-key/:provider`, `DELETE …/:account` | `save_console_key`, `remove_console_key` |
| `/api/agent/permission-rules` (3 routes in `api/auth.ts`) | → `threads` (standing permission rules), not this card |

CLI verb `sign-in` (`cli/signIn.ts`). `set_thread_model` is `native-harness`'s; providers takes part in it only through `DefaultAccounts`.

**8. Target file map.**

*(a) Files whose primary owner is `providers`* (18 files, 1,378 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `ai/Models.ts` | 53 | split: `providers/contract/service/access.ts` (`ModelAccess` ← `Models`, `ModelAccessFaces` ← `ModelsFaces`) and `providers/access.ts` (`modelAccessLayer` ← `modelsLayer`); `DEFAULT_MODEL` → `native-harness` (the default of `model_preference`); `CREDENTIAL_OWNER` → `platform` (`OPERATOR_PRINCIPAL`); `DEFAULT_INSTRUCTIONS` → each caller of `request` (the title's instructions in `threads`, the run's in `native-harness`): model access does not choose what a request says | — |
| `ai/OperatorCredentials.ts` | 178 | `providers/credentials/operator.ts` | `OperatorCredentials` stays: it is the operator's credentials for the model port |
| `ai/providerTokens.ts` | 38 | `providers/credentials/tokens.ts` | `createProviderTokens` |
| `ai/ConsoleKeyStore.ts` | 140 | `providers/credentials/consoleKeys.ts` | `ConsoleKeyStore`, `consoleAccountOf`, `ConsoleKeyRow` |
| `db/consoleKeys.ts` | 12 | `providers/store/tables.ts` (with the two below) | `consoleKey` |
| `db/accountQuotaReadings.ts` | 12 | `providers/store/tables.ts` | `accountQuotaReading` |
| `ai/unavailable.ts` | 10 | `providers/credentials/missing.ts` | `unavailable` → `credentialMissing` (it answers a missing credential) |
| `ai/ProviderAccounts.ts` | 70 | split: `providers/contract/service/accounts.ts` (`ProviderAccountsFaces` → `ProviderAccounts`, `StoredAccount`, `AccountSecret`) and `providers/accounts/stored.ts` (`subscriptionAccounts`, `providerAccounts`) | — |
| `ai/chooseAccount.ts` | 14 | `providers/accounts/choice.ts` | `AccountChoice`, `chooseAccount` |
| `ai/AccountQuota.ts` | 415 | `providers/quota/ledger.ts` (the layer and its internals), with the tag and faces in `providers/contract/service/quota.ts` | F4 watch: the refresh fiber becomes the declared pass `providers/quota/refresh.ts`, taking the file under 400 |
| `ai/QuotaReadings.ts` | 85 | `providers/quota/readings.ts` | `QuotaReadings`, `QuotaReading`, `QuotaReadingChange` |
| `ai/spendable.ts` | 68 | `providers/contract/service/quota.ts` (`spendability`, `signingAccount`, `callable`, `textModelOf`, `Spendability`) | pure functions over the quota table and the catalog |
| `ai/modelRuntime.ts` | 9 | `providers/runtime.ts` | `modelRuntime` |
| `protocol/modelCatalog.ts` | 37 | `providers/contract/wire/catalog.ts` | — |
| `protocol/accountQuota.ts` | 48 | `providers/contract/wire/accounts.ts` | — |
| `http/providerGate.ts` | 22 | `providers/registered.ts` | `registeredProvider`, `signInProvider`: the `unknown-provider` refusal belongs to the catalog's owner |
| `cli/signIn.ts` | 121 | `providers/cli/signIn.ts`, declared in `providers/cli.ts` | written against `platform/contract/service/verb.ts` (cut `providers → cli`) |
| `protocol/modelSelection.ts` | 28 | → `native-harness` (territory correction, §7.6): the model selection, its defaults and favourites are `model_preference`, native-harness's (section 5 §5.4.6); S2 renames are that card's | — |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `harness/AccountDefaults.ts` (native-harness) | `defaultAccount`, `saveDefaultAccount`, `adoptDefaultAccount`, `accountKeys`, the `defaultMoved` callback | `providers/accounts/defaults.ts` (`DefaultAccounts`) and its faces in `providers/contract/service/accounts.ts` |
| `thread/ThreadOwnerSettingsStore.ts` (native-harness) | the reads and writes of `default_accounts` | `providers/store/defaultAccounts.ts` over the new `default_account` table |
| `db/thread.ts` (thread-record) | `threadOwnerSettings.defaultAccounts` | the new table in `providers/store/tables.ts` |

*Parts received by name (v5):*
- from `socket/live.ts` L80–82 and `socket/rpc.ts` L112–126 (socket): the `accounts.subscribe` feed, served there directly today → declared and registered in providers's manifest with its name and `accountsFrameSchema` unchanged, before `socket M2` generates `rpc.ts` (review D1)

*(c) Symbols renamed:* `Models` → `ModelAccess`; `ModelsFaces` → `ModelAccessFaces`; `modelsLayer` → `modelAccessLayer`; `unavailable` → `credentialMissing`; `ProviderAccountsFaces` → `ProviderAccounts`.

*(d) Leaves:* `DEFAULT_MODEL` and `DEFAULT_INSTRUCTIONS` (to their callers), `CREDENTIAL_OWNER` (platform), `protocol/modelSelection.ts` (native-harness).

**9. Debt retired.**
- `modules`: `providers → cli` (1). Door edges `http → providers` (19) and `socket → providers` (4) are the doors'.
- `names`: `ai/AccountQuota.ts` F4 watch (415). (`protocol/modelSelection.ts`' S2 entries go with it to `native-harness`.)

**10. Graph work.**
- [[80570fd0]] "Which model may be spent, and on whose account" becomes `providers`' zone, less the thread's model selection (→ `native-harness`).
- Claims on `ai/*` and `http/providerGate.ts` are re-anchored at M1.
- [[82167fbe]] (the database's claims) contributes the `console_key` and `account_quota_reading` claims to this zone.
- `#module` `providers`, `dir` `apps/tagma/server/src/providers`, `depends-on` `settings`.

**11. Acceptance.**
1. `providers/` imports only `platform` and `settings`' contract; `ai/` is gone.
2. `set_default_account` and F041's `defaultAccount` road write `default_account` under its own revision; a concurrent writer refuses `stale-revision`; a thread's account never moves the default (section 4 §4.4.7).
3. The `default_accounts` column is gone after the D6 migration; every principal's map is in `default_account`; rollback to the previous binary finds the column refilled from the snapshot (section 2 §2.10).
4. The operations of 7 answer through generated endpoints; the typed routes retire one release after their callers (K2).
5. Zero `modules` and `names` debt for `providers`.

**12. Risks.**
- **Low floors must not load providers.** `settings` and `platform` are in `0d2c66a9`'s selection; if a builder imports `providers` from them at runtime, the gate refuses. Type-only imports load nothing and are allowed.
- **`AccountDefaults` is native-harness's primary file** and W6 is far away. This wave pulls its default-account part out (§7.4.4) and leaves the rest; `native-harness`'s code keeps calling `DefaultAccounts` through `providers`' contract.
- **The credential move is D0's**, not this wave's. If D0 has not run when W1 opens, providers does not open: the move must precede the first snapshot.

### 7.5.5 `thread-record`

**1. Ownership.** The identity and published facts of every thread, whatever runs it: project, lineage, birth provenance, principal, harness, agent, title, archive, pin and phase (section 1 §1.3). Directory `thread-record/`. Glossary words owned: **name** and **title** (section 5: `name` is the address a team uses, unique among siblings; `title` is what a reader sees), and the `ThreadId` brand.

**2. Wave.** W2, level 2. Opens after projects M1; runs beside `settings` and `providers`.
- **M1** (early): the contract, and the `thread_record_facts` read model over **today's** rows (`thread` joined to `thread`), so every dependent reads identity through the record before the migration.
- **D4** (the thread split, §7.2.4): once the six W2a store steps stand. The record's wave task owns the migration; the store steps are its participants.
- **M2** after D4 (review A3): the final map, the `thread_record` table and its `thread_record_facts` view merge only once the data has moved; before D4 the `M1` read model over today's rows is the only reader.
- **M3** after `M2` (the global rule of §7.2.2 adds nothing, since its only dependency beyond `platform` is `projects`).
- **N** (narrowing to `contract/`) after the `M2` of every incoming consumer: `workspace`, `change-record`, `executions`, `worktrees`, `landing`, `sandbox`, `threads`, both harnesses, `invocation` and the doors that read it. v2 put this condition on `M3`; it belongs to narrowing.

**3. Offers.**
- `contract/wire/ids.ts` — `ThreadId` (moved from `protocol/assignments.ts`, section 5 §5.4.3).
- `contract/wire/name.ts` — `randomThreadName`, `forkThreadName`, `NAME_SOURCES`, `NameSource`.
- `contract/wire/title.ts` — `TITLE_SOURCES`, `TitleSource` (the literals `'random' | 'generated' | 'manual' | 'agent' | 'harness'` are stored data and stay), `DEFAULT_TITLE`.
- `contract/wire/record.ts` — `ThreadRecordFacts` (the read model: id, project or none, origin `scoped | unscoped`, parent, spawn root, principal, name, title and its source and revision, harness, agent, born-of, spawned-by-run, created-by, scope block, opener, reader order, pinned, archived, phase, running run, created at), `ThreadPhase` (`running | idle | failed`).
- `contract/service/records.ts` — `ThreadRecords` (faces below) and the events.
  - reads: `facts(id)`, `projectOf(id)`, `countIn(projectId)`, `namesIn(projectId, unit)`, `isDescendant(id, ancestor, unit?)`, `subtree(id)`;
  - writes, each taking the caller's `WriteUnit` (the record is a participant in its callers' units, section 2 §2.4.3): `insert(unit, record)` (birth), `publishPhase(unit, {phase, runningRunId, expectedRunId})`, `setArchived(unit, ids, at)`, `setPinned(unit, id, at)`, `advanceReaderOrder(unit, id, at)`, `setTitle(unit, id, title, source)`, `nameTitle(unit, id, title, expectedRevision)`, `adoptTitle(unit, id, title, expectedRevision, sources)`, `claimTitleInput(unit, id, input)`.
- **Events published (C3):** `titleRecorded(threadId, revision)` → `threads`, `worktrees`; `phasePublished(threadId, phase)` → `change-record` (section 1 §1.4.3).
- **Manifest:** its table and view, its layer, the unscoped-record finding.

**4. Needs.** `platform` (units, `HarnessId`, `SessionRef`, `Principal`, the writer register); `projects` (key reference: a thread belongs to a registered project). Nothing else: the harness's rows, the mandate, the inbox and the run are higher and written by their owners in the same units.

**5. Tables** (section 2 §2.4.4 as amended by section 1 §1.13 and section 5 A5):
- `thread_record` (new, machine store, D4): `id`; `project_id` → `project` (null exactly when `origin = 'unscoped'`); `origin`; `parent_id` → `thread_record` cascade; `spawn_root_id`; `principal_id` (← `owner_id`); `name` with unique `(principal_id, spawn_root_id, name)`; `title`, `title_origin` (column name kept: data), `title_revision`, `title_asked_input`; `harness`; `agent_id`; `born_of`; `spawned_by_run_id` (no key); `created_by`; `scope_block_uuid`; `created_by_session_id` → the writer register; `reader_order_at`; `pinned_at`; `archived_at`; `phase`; `running_run_id` (no key); `created_at`.
- the view `thread_record_facts` — the read model's one query shape.
- Indexes per query (section 2 §2.4.4): `(principal_id, …)`, `(parent_id, created_at)`, the project reader-order partial index and the pinned and archived indexes that stand on `thread` today.
- **D4** (this wave, one migration, section 2 §2.4.4 steps 1–4 and §1.13's (a)–(h)): creates `thread_record` from `thread` ⋈ `thread`; unscoped records for `thread` rows without `thread`; the standing row → `thread_mandate` (threads), the facet whole → `external_session` (external-harnesses), the journal and lane re-keyed, legacy runs cut into external records, the native `thread` narrowed, shared tables re-pointed, the lower tables re-pointed; the whole-store foreign-key check before admission.

**6. Lanes, resources, passes.** None of its own. It is a participant in: birth (C2, threads coordinating), run transitions (C2, native-harness's run ledger and external-harnesses' session store), archive and pin (threads), title adoption (external-harnesses). No pass; the unscoped-record finding is measured by the doctor's existing pass over records.

**7. Operations.** None. `pin_thread`, `archive_thread(s)`, `generate_thread_title`, `adopt_thread_title`, `read_thread_record` are `threads`' (section 4 as amended), writing through `ThreadRecords`.

**8. Target file map.**

*(a) Files whose primary owner is `thread-record`* (4 files, 872 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `db/thread.ts` | 593 | **dissolves**, each table to its owner's `store/tables.ts` (the W2a store steps move them before D4): `thread_record` (new) and `thread_record_facts` → `thread-record/store/table.ts`; `thread_mandate` (new), `thread_inbox`, `harness_delivery_claim`, `thread_resource`, `thread_owner_rule` → `permission_rule`, `thread_owner_rule_withdrawn` → `permission_rule_withdrawal`, `thread_target_operation` → `thread_target_intent`, `thread_event`, `thread_rollout_cursor`, `thread_rollout_refusal`, `thread_export` (new) → `threads/store/tables.ts`; `thread` (narrowed), `thread_run`, `thread_log`, `thread_history_item`, `thread_entry`, `thread_compaction_checkpoint`, `thread_pruned_tool_call`, `thread_cache_observation`, `target_snapshot`, `workflow_run`, `model_preference` (new) → `native-harness/store/tables.ts`; `external_session` (new) → `external-harnesses/store/tables.ts`; `default_account` (new) → `providers/store/tables.ts`; `approval_preference` (new) → `threads/store/tables.ts`; `thread` and `thread_owner_settings` → dropped by D4 and D6 | Helpers go with their tables: `threadEventIdentity`, `THREAD_ENTRY_TOOL_LENGTH_INDEX` → threads (`thread_event`) and native-harness (`thread_entry`); `TAGMA_THREAD_SCOPE` → native-harness as `NATIVE_RUN_SCOPE` (S2; it selects runs of threads the native harness runs). The `*ProjectsForm` assertions go with their tables and are renamed `<Row>Matches` (S1 gate: `ThreadOwnerSettingsRowProjectsForm` and `ThreadOwnerRuleRowProjectsForm` are six words) |
| `harness/ThreadTitleStore.ts` | 190 | `thread-record/titles.ts` | `standing` loses its `harness` facet field (the facet leaves the record) and becomes `title`. `adopt`/`adoptExplicit` become `adoptTitle(unit, …, sources)`: the binding check against the facet's observation moves to `external-harnesses`, which opens the unit, checks its own `external_session` binding, checks the root lineage through `isDescendant`/`facts`, and calls `adoptTitle` (C2, coordinator above the record). Every write takes the caller's `WriteUnit` |
| `protocol/threadName.ts` | 46 | `thread-record/contract/wire/name.ts` | `NAME_ORIGINS` → `NAME_SOURCES`, `NameOrigin` → `NameSource` (decided here, §7.7: the type describes the name, so `NameSource`) |
| `protocol/threadTitle.ts` | 39 | split: `thread-record/contract/wire/title.ts` (`THREAD_TITLE_ORIGINS` → `TITLE_SOURCES`, `ThreadTitleOrigin` → `TitleSource`); the title **generation** result — `THREAD_TITLE_OUTCOMES`, `ThreadTitleOutcome`, `TITLE_FAILURES`, `TitleFailure`, `TITLE_FRESH_REASONS`, `TitleFreshReason`, `threadTitleResultSchema`, `ThreadTitleResult` → `threads` (naming a thread is a model call `threads` makes) | territory correction for the second part (§7.6) |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `protocol/assignments.ts` (workspace) | `ThreadId` | `thread-record/contract/wire/ids.ts` |
| `protocol/operations/shape.ts` (platform) | the `threadId` schema | `thread-record/contract/wire/ids.ts`, as `ThreadId`'s schema |
| `harness/ThreadStore.ts` (native-harness) | the record's reads and writes: `find` (identity part) → `facts`; `projectOf`, `projectIn` → `projectOf`; `countOfProject` → `countIn`; `titlesIn` → `namesIn`; `isDescendantOf`, `descendsFrom` → `isDescendant`; `subtreeIds` → `subtree`; `setArchived`, `setArchivedWhere`, `setPinned`, `advanceReaderOrder` → the record's writes; `runningRunOf`, `runningRun` (the record's `running_run_id`) → `facts`; the phase part of every status write → `publishPhase` | `thread-record/identity.ts` (`facts`, `projectOf`, `countIn`, `namesIn`), `thread-record/lineage.ts` (`isDescendant`, `subtree`), `thread-record/shelf.ts` (archive, pin, reader order), `thread-record/phase.ts` (`publishPhase` with the expected-run compare, section 2 §2.4.3) |
| `db/schema.ts` (graph) | nothing: `project` and `session` are referenced through `projects`' and `platform`'s contracts | — |

*(c) Symbols renamed:* `ThreadTitleOrigin` → `TitleSource`; `THREAD_TITLE_ORIGINS` → `TITLE_SOURCES`; `NameOrigin` → `NameSource`; `NAME_ORIGINS` → `NAME_SOURCES`; `TAGMA_THREAD_SCOPE` → `NATIVE_RUN_SCOPE` (native-harness); column `owner_id` → `principal_id` in `thread_record` (section 5 A5).

*(d) Leaves:* every other table of `db/thread.ts` (above), the title generation result (→ threads), the facet binding check (→ external-harnesses).

**9. Debt retired.**
- `modules`: `thread-record → external-harnesses` (3: `db/thread.ts` and `ThreadTitleStore.ts` → `protocol/harnesses.ts`, `protocol/harnessObservation.ts`), `thread-record → workspace` (1: `ProvedRoot` for `target_snapshot`, which leaves with its table), `thread-record → graph` (1: `db/schema.ts` for `project` and `session`). Door edges `http → thread-record` (3) are the doors'.
- `names`: `db/thread.ts` S1 (two `*ProjectsForm`), retired by the renames; its F4 watch and F5 signals end with the dissolution; `harness/ThreadTitleStore.ts` S2 (`ThreadTitle`, `ThreadTitleStore`).

**10. Graph work.**
- No zone owns the record today: its facts are spread over [[edd4a99c]] "The thread a reader sees" (titles, archive, pin, reader order), the database area [[9217020c]] (the tables) and the harness zones. The wave writes a new zone from the code after D4: identity and lineage, the phase and its expected-run compare, titles and their revisions, unscoped records.
- Claims re-anchored at M1: the title store's claims under [[edd4a99c]]; `8381611d` (the three folds) stays with native-harness and threads by section 1's split and is re-anchored when its table moves (W2a).
- `#module` `thread-record`, `dir` `apps/tagma/server/src/thread-record`, `depends-on` `projects`.

**11. Acceptance.**
1. `thread-record/` imports only `platform` and `projects`' contract; no file outside the record's owner writes `thread_record`.
2. After D4: every thread has one `thread_record` row; unscoped records exist exactly for `thread` rows that had no `thread` row, each with a finding; `thread` is gone; the whole-store foreign-key check passes; a late settle of run A after run B started leaves `running_run_id = B` (section 2 §2.7 AC 4).
3. A native run's phase and run row change in one commit; an external session's phase and `external_session` row change in one commit; no second status column exists.
4. `adopt_thread_title` adopts only for a root thread whose external binding matches, in one unit; a stale revision answers `false`, as today.
5. `titleRecorded` and `phasePublished` reach their subscribers after commit, and a subscriber that starts late recomputes from `thread_record_facts`.
6. Zero `modules` and `names` debt for `thread-record`; `db/thread.ts` is gone.

**12. Risks.**
- **D4 is the largest migration of the plan** and waits on six store steps. The record's M1 does not wait for it: the read model runs over today's rows first, so dependents can build against `ThreadRecords` while D4 is prepared. D4's test kills the process mid-migration and resumes (section 2 §2.7 AC 4).
- **`ThreadStore` is native-harness's primary file** (1,556 lines) and is read by nearly every thread path. This wave pulls the record's part out and leaves the rest; its importers switch to `ThreadRecords` in the same change, and the rest of the file waits for W6.
- **`title_origin` and its literals are data.** Renaming the TypeScript type to `TitleSource` must not rename the column or the stored values; the migration test compares them.
- **Principal rename.** `owner_id` → `principal_id` rides D4's copy-drop-rename; every reader of `ownerId` on a thread is rewritten in the same change, including `Actor.thread.principalId` (renamed in W0).

### 7.5.6 `workspace`

**1. Ownership.** Where work stands and what is in its trees: roots, repositories, coverage, environments and how one is acquired and released, assignments, checkout readings, acts and history, and the watch that reports their movement (section 1 §1.3). Directory `workspace/`. Glossary words owned: **root**, **repository**, **checkout** (and canonical checkout), **coverage**, **environment** (contract, identity, binding), **environment kind**, **environment backend** (the contract), **assignment**; the brands `RootId`, `UseId`, `EnvironmentId`, `EnvironmentUseId`, `RepositoryId`, `WorkspaceGeneration` (section 5 §5.4.3).

**2. Wave.** W3, level 3. Its **W2a store step** runs first (after platform M1): the assignment tables leave `db/` into `workspace/store/tables.ts`, because they reference `thread.id` and D4 re-points them. The wave itself opens after projects, thread-record and settings M1; runs beside `providers`, `power`, `mcp`. Carries D1's watcher and checkout reads, **E1** (the watcher API — paths or rescan — handle and watcher accounting, polling trees; section 3 §3.4.1, §3.4.4), the environment-backend hook (section 5 A3), the root-published and commit-overlay hooks, `ContextGeneration` → `WorkspaceGeneration`, and K2 for the checkout routes. `graph` opens at its M1; `change-record` needs its HEAD event and overlay slot.

**3. Offers.**
- `contract/wire/ids.ts` — `RootId`, `UseId`, `EnvironmentId`, `EnvironmentUseId`, `RepositoryId`, `WorkspaceGeneration`.
- `contract/wire/roots.ts` — roots, bindings, registration, overlap, footprint and their failures (`FileRoot`, `RootBinding`, `RootRegistration`, `RootOverlap`, `RootFootprint`, `RootMissing`, `RootUnavailable`, `RootReplaced`, `RootInconclusive`, `RootResolutionFailure`).
- `contract/wire/uses.ts` — root uses (`RootUse`, `UseConsumer`, `UseRequest`, `UseResolution`, `RootUseMissing`, `RootUseBusy`, `RootUseUncertain`).
- `contract/wire/repositories.ts` — `Repository`, `RepositoryBinding`, `CoveredRepository`, `StoresListing`, `RepositoryState` (← `RepositoryStanding`, section 5 "standing"), the repository failures.
- `contract/wire/coverage.ts` — `ProjectRoot`, `ProjectCoverage`, `RootAdmission`, `ProjectRootRefusal`, `ProjectRootsUnavailable`.
- `contract/wire/environments.ts` — identity, binding, kind, state, use, evidence, request, receipt and `EnvironmentRefusal`.
- `contract/wire/assignments.ts` — `Membership`, `RootSelection`, `Assignment`, `AssignmentActor`, `AssignmentTarget`, `AssignmentRequest`, `MembershipRelease`, `AssignmentBirth`, `Publication`, `SelectionRevision`, `RootState` (← `RootStanding`), the assignment failures. `ThreadId` has left for thread-record (7.5.5).
- `contract/wire/place.ts` — `WorkOrigin`, `ProvedRoot`, `WorkingRoot`, `WorkingOrigin`, `TargetAt`, `witnessKey`, `PlacedPath` (← today's `WorkingPlace` in `protocol/workingOrigin.ts`: a path placed against a root), `WorkingPlace` (← `Workspace` of `protocol/caller.ts`: a call's root and origin, §7.7), `encodeBinding` (← `protocol/subjectBinding.ts`).
- `contract/wire/checkout.ts` — the checkout row: `CheckoutEntryStatus`, `CheckoutOperation`, `CheckoutLines`, `ComparedPath`, `NamedThread`, `CheckoutHolder`, `CheckoutEntry`, `CheckoutArea`, `CheckoutEntries`, `CheckoutComparison`, `CheckoutCoverage`, `CheckoutState`.
- `contract/wire/history.ts` — `PathHistory` and the history page, `CommitReading`.
- `contract/wire/checkoutReads.ts`, `contract/wire/checkoutActs.ts` — the operation declarations of 7 and their answers (`CheckoutActed`, `CheckoutDiscarded`, `CheckoutCommitted`, `CheckoutPushed`, `CheckoutPulled`, `CheckoutFetched`, `CheckoutAborted`, `ACT_PATHS`), the page families `CHECKOUT_HISTORY`, `COMMIT_FILES`, and the permission subjects `resolutionSubjects`, `checkoutActSubjects`.
- `contract/service/` — `checkoutPaths.ts` (`pathWithin(root, path)`: the lexically bounded and `realpath`-checked workspace primitive of `read_path_exists`; graph chooses the served checkout, the primitive verifies both real paths); `roots.ts` (`FileRoots`, `RootUses`, `Coverage` ← `ProjectRoots`, `RootReservations` port); `repositories.ts` (`Repositories`, `RepositoryListing` ← `ProjectStoreOwner`/`ProjectStores`); `environments.ts` (`EnvironmentAccess`, `AcquiredEnvironment`, the **`EnvironmentBackend`** contract and `EnvironmentBackends` ← `EnvironmentProvider(s)`); `assignments.ts` (`Assignments`, the `ThreadLineage` port ← `ThreadStanding`); `checkouts.ts` (`CheckoutRows` ← `CheckoutStatus` class, `CheckoutReads` ← `CheckoutReadOwner`, `CheckoutActs` ← `CheckoutActOwner`, `CallerCheckout`); `places.ts` (`WorkingOrigins`, `WorkingRootReader`, `placeIn`, `placeAt`, `placeOfRoot`, `confineToTree`); `watch.ts` (the watcher API).
- **Hooks declared (start-bound, section 1 §1.4.3):** `EnvironmentBackend` ← `executions` (host), `sandbox` (guest); `RootPublished` ← `enforcement`; `CommitOverlay` (← `CommitStamps`) and `CheckoutWriters` ← `change-record`; `CheckoutHolders` ← `change-record` (who holds lines) and `graph` (the tasks each holder holds) — see 8 (d).
- **Events (C3):** `headMoved(rootId)`, `pathsChanged(rootId, paths | rescan)` → `graph`, `change-record`.
- **Contributions:** `RemovalHold` to `projects` (standing root uses and assignments refuse a removal).
- **Manifest:** its tables, its layer, its operations, the healing pass.

**4. Needs.** `platform` (service+adapter: filesystem witness, the OS watch primitive, git kit, units); `projects` (key-ref+hook: project key, `RemovalHold`); `thread-record` (key-ref: a thread key for assignments; see risk on lineage); `settings` (service: root and checkout preferences). Nothing else: the host backend, commit hooks, writers, stamps and holders arrive through its hooks.

**5. Tables** (machine store): `file_root_namespace`, `file_root`, `repository`, `root_use`, `root_use_hold`, `project_root`, `project_root_cover`, `environment`, `environment_use`, `assignment_membership`, `assignment_selection`. All keep their names (section 5 §5.4.6 lists none of them). `assignment_*` move in W2a and are re-pointed at `thread_record` by D4 (thread-record's migration; this module is a participant). `project_root.project_id` keeps its key to `project` through projects' contract. No migration of its own in this wave.

**6. Lanes, resources, passes.** The checkout readings keep their 3-permit readings semaphore and per-root epochs (`CheckoutStatus.ts`), declared under section 3's ranks as workspace's; E1 adds handle and watch accounting against the machine's file-handle ceiling (section 3 §3.12: an ungranted watch makes the tree **polling**). Pass: root healing (`RootHealing`, recovery class, driven at boot and on the cadence it has today — rule [[a00f91b0]]). Lifetimes: the **workspace lifetime** (section 4), numbered by `WorkspaceGeneration`, carrying the call's `WorkingPlace`.

**7. Operations.** `read_checkout`, `read_checkout_history`, `read_commit`, `read_repositories`; and the eight acts renamed by section 5 §5.4.6 to the verb-first grammar in this wave: `checkout_stage|unstage|discard|commit|push|fetch|pull|abort` → `stage_checkout`, `unstage_checkout`, `discard_checkout`, `commit_checkout`, `push_checkout`, `fetch_checkout`, `pull_checkout`, `abort_checkout` (owners by section 1 §1.13). Each old id stays an **alias resolving to the one canonical identity** before lookup and digest (K5a, section 4 §4.4.8), answers for one release and then refuses `operation-retired` naming the replacement; receipts made under the old id are found under the new one. Typed routes (K2):

| Route today | Operation | Owner |
|---|---|---|
| `GET /api/checkouts` (`read`) | `read_checkout` | workspace |
| `GET /api/checkouts/:rootId/history`, `…/commit` | `read_checkout_history`, `read_commit` | workspace |
| `POST /api/checkouts/:rootId/{stage,unstage,discard,commit,push,fetch,pull,abort}` | `*_checkout` (`stage_checkout` … `abort_checkout`) | workspace |
| `GET /api/checkouts/:rootId/picture` | **stays an HTTP resource** (review B1): raw image bytes with their MIME type, cache policy and `nosniff` (`http/handlers/checkouts.ts` L56–69), fetched as a Blob for an `<img>` by the app (`PictureDiff.svelte` L41–58, L103–108). The read and its type check move into workspace (`checkouts/picture.ts`, from `ThreadFiles.ts`' `pictureAt`); the route keeps its URL and headers and is excluded from K2's conversion | workspace |
| `GET /api/checkouts/:rootId/authorship` | `read_authorship` | change-record |
| `GET /api/repositories` (`stores`) | `read_repositories` | workspace |
| `GET /api/files/exists` | → **graph**'s new `read_path_exists` (7.5.7; review B2): it checks a path against the checkout **graph serves** (`CurrentGraph.checkout`), which graph owns; workspace supplies the primitive `pathWithin(root, path)` (`checkouts/paths.ts`, contract/service) keeping today's lexical bound and `realpath` of both ends (`http/handlers/files.ts` L149–167) | graph |

**8. Target file map.**

*(a) Files whose primary owner is `workspace`* (50 files, 6,454 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `db/assignments.ts`, `db/environmentUses.ts`, `db/environments.ts`, `db/fileRoots.ts`, `db/projectRoots.ts`, `db/repositories.ts`, `db/rootUses.ts` | 199 | `workspace/store/tables.ts` | `db/assignments.ts` moves in W2a; the rest at M2. `thread.id` → thread-record's key after D4; `project` → projects' contract |
| `working/FileRootStore.ts` | 235 | `workspace/store/roots.ts` | `FileRootStore`, `RootAdoption` |
| `working/RepositoryStore.ts` | 153 | `workspace/store/repositories.ts` | — |
| `working/RootUseStore.ts` | 84 | `workspace/store/uses.ts` | — |
| `graph/projects/ProjectRootStore.ts` | 97 | `workspace/store/coverage.ts` | `ProjectRootStore` → `CoverageStore` (F2 cleared) |
| `working/AssignmentStore.ts` | 133 | `workspace/store/assignments.ts` | moves in W2a |
| `workspaces/EnvironmentStore.ts` | 61 | `workspace/store/environments.ts` | — |
| `workspaces/EnvironmentUseStore.ts` | 156 | `workspace/store/environmentUses.ts` | — |
| `working/FileRoots.ts` | 327 | `workspace/roots/registry.ts` | two-phase registration, binding judgement, footprint, identity probes: one subject (a root's registration and identity) |
| `working/RootUses.ts` | 184 | `workspace/roots/uses.ts` | — |
| `working/RootHealing.ts` | 67 | `workspace/roots/healing.ts` | the pass of 6 |
| `working/RootReservations.ts` | 19 | `workspace/contract/service/roots.ts` | port types only |
| `graph/projects/ProjectRoots.ts` | 289 | `workspace/roots/coverage.ts` | `ProjectRoots` → `Coverage` (F2 cleared); its removal claim becomes the `RemovalHold` contribution |
| `working/WorkingOrigins.ts` | 142 | `workspace/roots/proof.ts` | placement and proving of a root: one subject; `WorkingOrigins` keeps its name as the boundary service (F2 is the file's, cleared by the move) |
| `harness/WorkingSubjects.ts` | 31 | `workspace/roots/bindings.ts` | `workingBindings` |
| `working/Repositories.ts` | 330 | `workspace/repositories/registry.ts` | F3 cleared by the path; `Repositories` stays the service name |
| `worktrees/ProjectStores.ts` | 138 | `workspace/repositories/listing.ts` | `ProjectStoreOwner` → tag `RepositoryListing`; `ProjectStores` → private `Listing`; `StoresFailure` → `ListingFailure` |
| `working/keptName.ts` | 25 | `workspace/repositories/pushName.ts` | `keepName`, `keptNameOf`, `keptUpstream`; the git config key `branch.<b>.tagmaPushAs` is data and stays |
| `workspaces/EnvironmentAccess.ts` | 297 | `workspace/environments/access.ts` | — |
| `workspaces/EnvironmentUses.ts` | 135 | `workspace/environments/uses.ts` | — |
| `workspaces/EnvironmentProviders.ts` | 64 | `workspace/contract/service/environments.ts` | `EnvironmentProvider` → `EnvironmentBackend`, `EnvironmentProviders` → `EnvironmentBackends`, `EnvironmentResources` stays (section 5 A3) |
| `workspaces/AcquiredEnvironment.ts` | 12 | `workspace/contract/service/environments.ts` | — |
| `workspaces/environmentFailure.ts` | 23 | `workspace/environments/failure.ts` | `asRefusal` |
| `working/Assignments.ts` | 221 | `workspace/assignments/membership.ts` | F3 cleared; `ThreadStanding` port → `ThreadLineage` (section 5 "standing"; S4: the name was declared twice) |
| `working/threadStanding.ts` | 51 | **dissolves**: `threadProjectIn`, `threadDescendsFrom`, `subtreeOf` are thread-record's `projectOf`, `isDescendant`, `subtree` (7.5.5 (b)); `ThreadLineage` is bound to them at `start` | its readers in native-harness and executions switch to `ThreadRecords` |
| `working/CheckoutStatus.ts` | 671 | split by subject (F4 gate): `workspace/checkouts/rows.ts` (L140–516: held rows, reads, follows, marks, hold/linger/watch lifecycle, the read cycle and holder question — `CheckoutRows` ← `CheckoutStatus`, `CheckoutRoot`, `CheckoutRecord`, `CheckoutRecords`, `CheckoutAsked`, `RecordedTree`); `workspace/checkouts/comparison.ts` (L518–671: comparison cache, shared tree reading, row assembly); `workspace/checkouts/weight.ts` (L31–138: capture budgets, `opensBinary`, `untrackedWeight`) | the class keeps its semaphore and caches (6); `opensBinary` stays exported for change-record |
| `worktrees/CheckoutReads.ts` | 369 | `workspace/checkouts/reads.ts` | `CheckoutReadOwner` → tag `CheckoutReads`; the class → private `Reads`; `CommitStamps` → the `CommitOverlay` hook, which **`change-record`** fills with the thread overlay (7.5.10); `admittedWorktreeRefusal` (worktrees) replaced by workspace's own `CheckoutPlaceRefusal` mapping |
| `working/CheckoutActs.ts` | 278 | `workspace/checkouts/acts.ts` | `CheckoutActOwner` → tag `CheckoutActs`; the class → private `Acts`; `CheckoutWriters` → the hook of 3; the graph directory is an argument of the checkout-acts layer (`graphDirectory`), passed by `composition` from graph's `GRAPH_DIRECTORY` (8 (d)) |
| `working/TreeWatch.ts` | 131 | `workspace/watch/tree.ts` | `TreeMovement`, `TreeWatch`, `watchingHead`, `watchingCheckout` become the watcher API of E1 (paths or `rescan`); `watchAll`, `watchTree` (L37–97, the OS primitive) → platform (8 (d)) |
| `worktrees/setupCopy.ts` | 35 | `workspace/checkouts/ignoredCopy.ts` | `copyIgnored` (registry: worktrees → workspace "ignored-file copy"; enforcement's work directories read it too) |
| `protocol/working.ts` | 157 | split: `contract/wire/roots.ts` (L9–60 and the root failures through `RootResolutionFailure`, L104–138), `contract/wire/uses.ts` (L65–102 and `RootUseMissing`, `RootUseBusy`, `RootUseUncertain`, `RootUseFailure`, L139–157), `RootId`, `UseId` → `contract/wire/ids.ts` | F5 signal ends |
| `protocol/repositories.ts` | 125 | `contract/wire/repositories.ts` | `RepositoryStanding` → `RepositoryState` |
| `protocol/environments.ts` | 114 | `contract/wire/environments.ts` | ids → `ids.ts` |
| `protocol/assignments.ts` | 105 | `contract/wire/assignments.ts` | `ThreadId` → thread-record (W2); `RootStanding` → `RootState` |
| `protocol/projectRoots.ts` | 46 | `contract/wire/coverage.ts` | — |
| `protocol/workingOrigin.ts` | 84 | split: `contract/wire/place.ts` (L9–44, `TargetAt`; `ContextGeneration` → `WorkspaceGeneration` into `ids.ts`; `WorkingPlace` → `PlacedPath`); `TargetSnapshot`, `GraphOrigin`, `rootOf`, `originOf`, `atOf` (L46–84 less `TargetAt`) → `threads/contract/wire/target.ts` | a thread's target snapshot is threads' concept (its table is native-harness's, above threads); `TargetAt` stays because `executions` (below threads) reads it |
| `protocol/checkoutStatus.ts` | 147 | split: `contract/wire/checkout.ts` (L6–97); the thread frame (L99–147: `ThreadFileStanding` → `ThreadFileState`, `ThreadFile`, `ThreadCommit`, `ThreadCommitLimit`, `ThreadFileList`, `THREAD_COMMITS`) → `change-record/contract/wire/threadFiles.ts` | territory correction (§7.6): a thread's files and commits are authorship |
| `protocol/checkoutCommit.ts`, `protocol/checkoutHistory.ts` | 46 | `contract/wire/history.ts` | — |
| `protocol/operations/checkouts.ts` | 124 | `contract/wire/checkoutReads.ts` | plus `read_repositories` |
| `protocol/operations/checkout.ts` | 260 | `contract/wire/checkoutActs.ts` | — |
| `graph/projects/WorkingOwners.ts` | 94 | **dissolves**: the workspace services' assembly → `workspace/workspace.ts` (assembly surface); the host backend (`HostEnvironment` with `installationAnchor`) → executions' `EnvironmentBackend` contribution, bound at `start`; `Worktrees`, `WorktreeStore` → worktrees' own layer | `WorkingOwners`, `WorkingFaces`, `workingLayer` retire (S3 signal); readers (`http/caller.ts`, `http/door.ts`, `http/handlers/handlers.ts`, `terminals/terminalsLayer.ts`, `harness/Stack.ts`, `http/runtime.ts`) take the named services |
| `graph/projects/holders.ts` | 111 | **dissolves** by subject: `agentNames` → thread-record `ThreadRecords.facts` over ids (name and archive); `heldTasks`, `HeldTask` → `graph` (the tasks a session holds, which landing already reads); `namedHolders`, `holderOf`, `NamedHolder`, `HolderStores` → the `CheckoutHolders` hook (change-record answers holders of lines, graph adds their tasks, workspace merges) | territory correction (§7.6): appendix B read it as the removal hold; it names who holds a tree's lines |
| `http/poolFixture.ts` | 34 | composition's test world (section 6) | fixture assembling several modules |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `protocol/caller.ts` (platform) | `Workspace` | `contract/wire/place.ts` as `WorkingPlace` |
| `protocol/subjectBinding.ts` (platform, corrected to workspace in §7.6) | `encodeBinding` | `contract/wire/place.ts` |
| `protocol/pageFamilies.ts` (platform) | `CHECKOUT_HISTORY`, `COMMIT_FILES` | `contract/wire/checkoutReads.ts` |
| `graph/projects/repo.ts` (graph) | `checkoutAt`, `checkoutsOf`, `standsAside`, `CallerCheckout`, `CallerCheckoutState`, `RepoCheckout` → `GitCheckout`, `RepoWorktree` → `GitWorktree` | `workspace/checkouts/git.ts`; `CallerCheckout` → `contract/service/checkouts.ts` (its key `tagma/graph/CallerCheckout` → `tagma/workspace/CallerCheckout`) |
| `harness/ThreadFiles.ts` (change-record) | `pictureAt`, `Picture`, `PictureReadRefusal` (L734–773, L136, L259) | `workspace/checkouts/picture.ts`, behind the retained picture route (review B1) |
| `protocol/worktreeSubjects.ts` (worktrees) | `resolutionSubjects`, `checkoutActSubjects` | `contract/wire/checkoutReads.ts`, `checkoutActs.ts` |
| `protocol/operations/working.ts` (worktrees) | `read_repositories` (L64–90) | `contract/wire/checkoutReads.ts` |
| `operations/worktrees.ts` (worktrees) | executors of `read_repositories` (L119–134), `read_checkout` … `checkout_abort` (L296–491; renamed `*_checkout` in this wave) | `workspace/operations/reads.ts`, `workspace/operations/acts.ts` |
| `api/checkouts.ts`, `api/worktrees.ts` `stores`, `api/files.ts` `exists` (http) | the routes of 7 | retire through K2 |

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `socket/checkoutChannel.ts` (socket, §7.6) → `checkouts/feed.ts`, declared in workspace's manifest
- from `http/handlers/files.ts` L149–167 (http): the lexical confinement and `realpath` of both ends → `checkouts/paths.ts` with `pathWithin(root, path)` exposed by `contract/service/checkoutPaths.ts`, for graph's `read_path_exists` (review B2). Graph passes `CurrentGraph.checkout`; the primitive preserves `path-outside-tree` on a symlink escape and the unread/stat refusal on failures; generic HTTP answering stays in http

*(c) Symbols renamed:* `ContextGeneration` → `WorkspaceGeneration`; `WorkingPlace` → `PlacedPath`; `Workspace` → `WorkingPlace`; `EnvironmentProvider(s)` → `EnvironmentBackend(s)`; `ThreadStanding` → `ThreadLineage`; `RootStanding` → `RootState`; `RepositoryStanding` → `RepositoryState`; `ThreadFileStanding` → `ThreadFileState` (change-record); `ProjectRoots` → `Coverage`; `ProjectRootStore` → `CoverageStore`; `CheckoutStatus` (class) → `CheckoutRows`; `CheckoutReadOwner` → `CheckoutReads`; `CheckoutActOwner` → `CheckoutActs`; `ProjectStoreOwner` → `RepositoryListing`; `CommitStamps` → `CommitOverlay`; `RepoCheckout` → `GitCheckout`; `RepoWorktree` → `GitWorktree`. Frozen: every table and column, the refusal codes, `tagmaPushAs`, the `witnessKey` tuple.

*(d) Leaves:*
- `TargetSnapshot`, `GraphOrigin`, `rootOf`, `originOf`, `atOf` → `threads`; the thread frame of `checkoutStatus.ts` → `change-record`; `heldTasks` → `graph`; `agentNames` → `thread-record`.
- `watchAll`, `watchTree` → `platform` as the OS watch primitive (`platform/watch/`, section 1: "OS watch" is platform's adapter). **Correction to the platform card (7.5.1):** it receives this part; it lands at platform's M2 or, if platform has closed, in this wave's M1 as a platform change.
- `CHECKOUT_DIRECTORY` (`protocol/storage.ts`) **stays graph's** (section 1 §1.7 rule 11: graph owns its storage paths and passes them as arguments), renamed `GRAPH_DIRECTORY` in `graph/contract/wire/storage.ts`, value `.tagma` unchanged. `workspace` cannot import graph (graph depends on it), so its checkout acts take the directory as a layer argument `graphDirectory: string`; `composition`, which reads every contract, passes graph's constant at assembly. The same argument reaches `change-record` and `sandbox`, which have no relation to graph; `landing` and `invocation` have one and import the constant. No platform constant, no new facade. *(v2 moved it to platform; both reviews rejected that as a territory correction contradicting §1.7.)*
- `HostEnvironment` construction → `executions`; worktree services → `worktrees`; `poolFixture.ts` → composition.

**9. Debt retired.**
- `modules`: `workspace → graph` (7: `projectRoots.ts` by projects' key reference; `holders.ts` by its dissolution; `poolFixture.ts` to composition; `CheckoutActs.ts` by the `graphDirectory` argument); `workspace → worktrees` (5: `WorkingOwners.ts` dissolved; `checkout.ts`, `checkouts.ts` by the subjects moving here; `CheckoutReads.ts` by its own refusal); `workspace → installation` (1) and `workspace → executions` (1), both in `WorkingOwners.ts`, by the backend hook. The `platform → workspace` edge (`caller.ts`) is platform's and is cut by `WorkingPlace` moving here. Door edges into workspace are the doors'.
- `names`: `graph/projects/ProjectRootStore.ts` F2, `graph/projects/ProjectRoots.ts` F2, `working/WorkingOrigins.ts` F2, `working/Assignments.ts` F3, `working/Repositories.ts` F3, `working/CheckoutStatus.ts` F4 (671), `working/CheckoutActs.ts` S3 (`CheckoutActOwner`), `worktrees/CheckoutReads.ts` S3 (`CheckoutReadOwner`), `worktrees/ProjectStores.ts` S3 (`ProjectStoreOwner`). The seven F5 signals of `protocol/` are watch and end with the splits.

**10. Graph work.**
- [[6442078a]] "The places work happens in" (area over `worktrees/` and `workspaces/`) splits. Its areas [[3bf662bf]], [[c7cb1f26]], [[d655d1e5]], [[7cf334d1]], [[a96e9e89]], [[b4cc1324]], [[3f091b84]] re-hang under `#module` `workspace`, re-anchored at M1; [[0fe81f69]], [[9c02d7f7]], [[f690ada2]], [[af4f0ba5]] stay with `worktrees` and `landing` (their cards); [[376d1e0e]] "Where an admitted generation stands" splits: the generation to workspace, the target snapshot to threads.
- The coverage claims under [[fe468405]] (`2b1cfed4`, `9b12db7a`, `5897973b`) move to workspace's coverage area.
- Rule [[1e4a8f0d]] stands in the dissolving area: if it is enforced it moves only through `enforce_rule` with the operator's approval (§7.2.6); otherwise it re-hangs under `workspace`.
- Claims to rewrite at M2: any sentence naming `EnvironmentProviders`, `ContextGeneration`, `WorkingOwners` or the `*Owner` tags; [[79430bed]] re-anchored to `workspace/store/tables.ts`.
- Tasks: [[4cf14a5a]] (write the claims of the places work happens in) closes into the zone the wave writes; [[324bbed1]] (git status storm) re-hangs under the checkout rows area — E1's named paths are its fix; [[82167fbe]] and [[b1309732]] lose their workspace parts.
- `#module` `workspace`, `dir` `apps/tagma/server/src/workspace`, `depends-on` `projects`, `thread-record`, `settings`.

**11. Acceptance.**
1. `workspace/` imports only `platform`, `projects`, `thread-record` (key reference and the `ThreadLineage` binding) and `settings`; zero `modules` and `names` debt.
2. Opening an environment of a kind with no backend bound refuses naming the kind; host and guest backends answer refused and lost distinctly, and a retained admission is written inside workspace's unit (section 1 AC 13).
3. The watcher reports named paths or a rescan with its reason; an event without a file name is a rescan, never dropped; a tree without a granted watch reads as polling and says so.
4. `read_commit` for a thread marks the paths it delivered when `change-record` has contributed the overlay, and answers unmarked, saying so, when it has not.
5. A root published by any path carries enforcement's commit hooks before the publishing act answers, or the answer names the failure.
6. `remove_project` refuses while a root use or an assignment stands, naming it.
7. The checkout routes answer through generated operation endpoints; the picture route stays an HTTP resource with its URL, MIME type, cache policy and `nosniff` unchanged.

**12. Risks.**
- **Lineage crosses the registry's key-ref.** Assignment admission asks whether an actor's thread is an ancestor of the target thread. The port `ThreadLineage` keeps the question workspace's and the answer thread-record's, bound at `start`; the registry pattern `workspace → thread-record` widens from `key-ref` to `key-ref+port-binding` (no new relation, §7.6's registry note). If section 1 declines it, admission moves up to `threads`, which already coordinates every assignment write.
- **`CheckoutStatus` is hot** (task [[324bbed1]]). The split must keep one semaphore and one comparison cache per process; the builder moves the class first, splits after, and compares the reading counts of a busy repository before and after (section 3's reading telemetry).
- **`holders.ts` feeds four modules.** Its dissolution lands in one change with the `CheckoutHolders` hook and graph's task contribution, or the row loses its holders' tasks; until graph's M1 the tasks part is bound from graph's current code.
- **`WorkingOwners` has six readers across the doors.** M1 gives them the named services; the doors' own waves remove the rest.

### 7.5.7 `graph`

**1. Ownership.** The project's knowledge — blocks, vocabulary, law, measurement, orientation and work — and its serving from each checkout's store, files and shadow git (section 1 §1.3). Directory `graph/` (kept). Glossary words owned: **block**, **tag**, **catalog** (the installed declaration; its shipped content is `catalogs`'), **claim**, **source**, **finding**, **journal**, **served graph**, **mirror**, **tree** (the graph's files a repository carries), **shadow**, **standing** (a block neither resting nor replaced), **owner** (the block that owns a code path), **lens**.

**2. Wave.** W3, level 4. Opens after projects, settings and workspace M1; runs beside `change-record`. Carries **D1** (graph store: chain, inventory, typed stamps, the tree descriptor — the vocabulary format marker and the newer-format write and install refusal already ran as release N in P0, in today's `graph/core/Tags.ts`, and move here with the file — completion-stamp serving, the copy of mirrors), **D2** (graph acts: `graph_act` with plan and sequence, projection after commit, exact landing sets from a private index, trailers, landing detection, `unpublished` and `conflicted` with `resolve_graph_conflict`, the recovery driver), **E2** and **E5** of base section 3 (the entry gate and tree permit ranks 400/420, the freshness repair by named paths, rescan as recovery; distinct from addendum §3.13 E5, tracked here as `perf E5`), the rest of **D6** (catalog requests; `project_policy`; graph's registry participant), and K2 for the graph routes. `catalogs` and `installation` open at its M1. M1 is early: the contract (wire and services) is extracted first, because nine modules above read `ProjectCall`, `Lens`, the tag table and the block rows.

**3. Offers.**
- `contract/wire/` — (`fields.ts` imports `trimmed` from platform) `rows.ts` (projects, branches, block rows, edges, sources, writers, verdicts, endings, the block read), `reads.ts` (pages, block changes, diffs, marks), `reports.ts` (findings, doctor reports without the install states and hook ledger, gauges, ready, proposals, batch outcomes, reflection pages), `batch.ts`, `query.ts`, `fields.ts`, `edges.ts`, `sources.ts`, `findings.ts`, `remedies.ts`, `identity.ts`, `references.ts`, `journal.ts`, `feed.ts` (← `graphFeed.ts`), `instructions.ts`, `lifecycle.ts`, `standing.ts` (← `protocol/blocks.ts`: standing and resting predicates), `storage.ts` (`STORAGE_MODES`, `StorageMode`, `WORKFLOWS_DIRECTORY`, the policy names `PROJECT_SETTINGS`, `ProjectSetting`, `TAGMA_HOME`, `SERVES_FROM`, `ServesFrom`, `blocksRetiredKey` from `protocol/projects.ts`), `branchChanges.ts` (`GraphChanges`, `GraphKindChanges`: graph's own contract, today in landing's `protocol/worktreeFinishing.ts`), `call.ts` (`ProjectCall`, `Lens`, `NameReach`, `CurrentProject` and the refusal unions `CallerRefusal`, `OpenRefusal`, `ReferenceRefusal`, `ServingRefusal`, received from platform), `tags/table.ts` (`TagTable`), `tags/roles.ts`, `tags/declaration.ts` (← `shape.ts`), `operations/*.ts` (the operation declarations of 7, split below).
- `contract/service/` — `acts.ts` (`Act`, `ActFaces`, `TreeGuard` ← `TreeFloor`, `CommitHooks`, `Measure`), `blocks.ts` (`Blocks`, the create/update/edit refusal unions), `sources.ts` (`Sources`, `FileOwner`, `FileOwnership`, `PlacementRefusal`, `CheckRefusal`), `measure.ts` (`Doctor`, `GraphMeasure`, `MeasureDrain`, `SweepWatermark`), `vocabulary.ts` (`Tags`, `Catalogs`), `journal.ts` (`Journal`, `GraphFeed`), `orientation.ts` (`Orientation`, `Touches`, `Digest`), `work.ts` (`Tasks`, `Review`, `Reflections`, `Supersession`, `Batch`), `serving.ts` (`GraphPool`, `ServedGraphs`, `CurrentGraph`, `MeasuredCheckout`, `ServedTree`, `FreshnessGate`), `tasksHeld.ts` (the tasks a session holds — fills change-record's `HeldTaskLabels` for every `read_changes` row, read by `landing` and contributed to workspace's `CheckoutHolders`).
- **Ports and hooks declared:** the **gauge** hook (← external-harnesses' hook ledger); the **enforced-law contract** (← enforcement: the `lawEnforcement` codec and its runtime part, applied by graph in its mutation unit — section 9's descriptor); **catalog content** (argument ← catalogs); **doctrine law sections** (argument ← threads); **`SessionNames`** (a port bound at `start` by composition from `thread-record`: the names a touch brief shows).
- **Hooks filled:** `RemovalHold` (projects: live knowledge refuses a removal); `CheckoutHolders` (workspace: the tasks each holder holds); `ManagedWrite` for `graph.catalogs` (settings); the registry participant (installation).
- **Events:** the live feed (published after commit, per project); `findingsFiled`; `blocksMoved` (the doctor's announce); `projectPolicyChanged` (after commit, when `project_policy` changes — installation's registry export subscribes).
- **Manifest:** its tables, layers, operations, the CLI verbs `blocks`, `law` and graph's half of `projects` (`set`, `storage`), the passes of 6.

**4. Needs.** `platform` (graph store, units, durable files, git kit, writer register); `projects` (registration, project key, `RemovalHold`); `settings` (graph keys, the decided fingerprint, the managed catalog write); `workspace` (roots, coverage, checkout watch, `headMoved`, `pathsChanged`, `CallerCheckout`). Arguments and hooks above bring catalogs, enforcement, threads, thread-record and external-harnesses in without an import.

**5. Tables.** Graph store (one per served tree): `block`, `block_tag`, `block_field`, `edge`, `search_index` and its FTS mirror, `ref`, `source`, `finding`, `touch`, `session` (graph's journal projection), `event`, `sweep_mark`, `comment_scan`, `meta`, the graph copy of `project`; new by D1/D2: the graph stamp and inventory, `graph_act`. Machine store: **`project_policy`** (new, D6 — `strict_provenance`, `private`, `storage` leave `project`; §7.5.2). Migrations of this wave: D1's chain and stamps, D2's `graph_act`, D6's policy cut and registry participant; `meta`'s keys `journal-off-floor` and `legacy-shape` are data and stay. From accepted [[9c085c6c]] (§3.13.13 E1, E2, E4 in this wave; E5's graph part with `perf E5`): `name_use(project_id, holder_id, name, tail, kind, target_id)`, the `source(ref, kind)` index, `absorption(by_id, block_id)` and `measure_pending` (one row per mark, replacing the JSON `meta` row) in E2's graph-chain migration; `block.text_rev`, `proj_rev`, `child_rev` with their triggers and the touched-codec and touched-path triggers with `perf E5`; `edit_block`'s event keeps the edit's exact patch.

**6. Lanes, resources, passes.** Ranks 400 (entry gate per tree: open, retire, evict) and 420 (tree permit: one act's P1–P2, the batch capture, repairs of named paths) — `http/treePermits.ts`' three permits become these declarations (section 3 table). Passes: freshness repair and rescan (background, on watcher epochs), topology sync (on `headMoved`), the measure drain (recovery class, self-driving at boot — claim [[d52bdc5e]]), the doctor, tree commits (batched behind quiet with a ceiling), the D2 recovery driver. The measure worker is a thread resource with crash fallback (`measureThread.ts`). Lifetimes: graph's serving contributes the call's served graph and lens.

**7. Operations.** Owned. Two are renamed by section 5 §5.4.6 in this wave — `graph_overview` → **`read_overview`**, `ready_tasks` → **`list_ready_tasks`** — each old id an alias resolving to the one canonical identity (K5a, section 4 §4.4.8), for one release, then `operation-retired` naming the replacement. The owned set after the wave: `read_overview`, `read_tags`, `search_blocks`, `query_blocks`, `read_block`, `read_zone`, `list_ready_tasks`, `run_doctor`, `run_doctor_all`, `read_brief`, `read_review_brief`, `read_events`, `read_owners`, `read_findings`, `read_gauges`, `read_reflections`, `read_proposals`, `create_block`, `update_block`, `edit_block`, `claim_task`, `release_task`, `finish_block`, `close_block`, `file_delta`, `verify_block`, `unverify_block`, `apply_batch`, `accept_proposal`, `uphold_proposal`, `revise_proposal`, `reject_proposal`, `reanchor_path`, `file_reflection`, `answer_reflection`, `unanswer_reflection`, `supersede_block`, `unsupersede_block`, `link_blocks`, `unlink_blocks`, `anchor_block`, `unanchor_block`, `delete_block`, `restore_block`, `sync_graph`, `resolve_graph_conflict` (D2), `set_project_policy`, `set_project_storage`, and new `read_path_exists` (the path-exists check against the served checkout, review B2), `list_branches`, `list_root_blocks`. **Leave:** `submit_work` → `landing`; `read_installation_status` → `external-harnesses` (it reports the skill, hook and workflow installs in the machine's CLIs); `read_settings`, `write_setting`, `write_setting_layer` → `settings`; `read/add/enable/remove_mcp_server` → `mcp`. Typed routes (K2), each to an existing operation unless marked new:

| Routes today | Operation |
|---|---|
| `api/blocks.ts`: read, zone, create, update, edit, revise, trash, restore | `read_block`, `read_zone`, `create_block`, `update_block`, `edit_block`, `revise_proposal`, `delete_block`, `restore_block` |
| `api/blocks.ts`: titles, diff, setEnabled, trashRoots, tree | new: `read_titles`, `read_block_diff`, `set_rule_enabled`, `list_trash`, `read_tree` |
| `api/gauges.ts` | `anchor_block`, `unanchor_block`, `reanchor_path`, `verify_block`, `unverify_block`, `read_owners`, `read_gauges` |
| `api/journal.ts` | `read_events`; new: `read_journal`, `read_journal_vocabulary` |
| `api/measure.ts` | `run_doctor`, `read_findings` |
| `api/orientation.ts` | `read_brief`; new: `read_prime`, `read_law`, `read_session_start`, `read_first_prompt`, `read_touch_brief` |
| `api/review.ts` | `apply_batch`, `file_reflection`, `read_reflections`, `answer_reflection`, `unanswer_reflection` |
| `api/selection.ts` | `list_ready_tasks`, `query_blocks`, `search_blocks`, `read_proposals`, `link_blocks`, `unlink_blocks`; new: `read_edges`, `read_refs` |
| `api/standing.ts`, `api/work.ts` | `supersede_block`, `unsupersede_block`, `accept_proposal`, `reject_proposal`, `uphold_proposal`, `claim_task`, `release_task`, `finish_block`, `close_block`, `file_delta` |
| `api/tags.ts`, `api/sessions.ts` | `read_tags`; new: `list_sessions` |
| `api/files.ts`: log, resolve, sync, exists | new: `read_block_log`; `resolve_graph_conflict`; `sync_graph`; `exists` → new **`read_path_exists`** (graph: `CurrentGraph.checkout` chooses the served checkout; workspace's `pathWithin` primitive keeps the lexical bound, `realpath` of both ends and `path-outside-tree` refusal of `http/handlers/files.ts` L149–167; its report schema is graph's `protocol/files.ts`); `stripComments` → change-record |
| `api/projects.ts`: current, setSetting, setStorage, branches, roots | `read_overview` with `cwd`; `set_project_policy`; `set_project_storage`; new: `list_branches`, `list_root_blocks` (answer: the root blocks as `BlockRecord` rows, as `wireBlock` renders them today) |

CLI verbs: `blocks` (switch a rule, trash roots), `law`; `projects set` and `projects storage` (from projects' verb). `status` leaves for `installation` (8 (d)).

**8. Target file map.**

*(a) Files whose primary owner is `graph`* (148 files, 29,549 lines). Paths below are relative to `graph/`.

*Store, acts and blocks (`graph/core`, `db/schema.ts`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `db/schema.ts` | 276 | `store/tables.ts` (the graph-store tables); `compactUuid`, `spokenTail` → `store/identity.ts`; `project` → **`projects`** (7.5.2), `setting` → **`settings`** (7.5.3), `session` → **`platform`** `store/writers.ts` (7.5.1); nothing to **`thread-record`**, which references `project` and `session` through those owners' contracts (7.5.5) | F5 ends with the split |
| `graph/core/Act.ts` | 824 | split by subject (F4 gate; claimed by five areas, task [[68203367]]): `contract/service/acts.ts` (L33–87, L211–264); `acts/unit.ts` (L520–625: unit and transaction with the tree guard, drain and commit hooks; measure scheduling); `acts/marks.ts` (L89–209: measured-mark SQL, `answeredBy`, `verifiedCondition`); `acts/records.ts` (L266–420: layer, row reads, journal `record`); `acts/derived.ts` (L422–518, L798–821: search, tag and ref sync, edge insert, backfill); `acts/names.ts` (L627–797: name, tree and answer resolution) | `TreeFloor`, `TreeFloorFaces` → `TreeGuard`, `TreeGuardFaces` (S7 gate) |
| `graph/core/GraphTransaction.ts` | 26 | `acts/state.ts` | `GraphTransaction` → `ActState` (the per-act unit state; F2 word dropped) |
| `graph/core/reads.ts` | 5 | `acts/reads.ts` | — |
| `graph/core/refusal.ts` | 21 | → **`platform`** `contract/service/body.ts` (territory correction, §7.6) | `refusing` folds a failure into a refusal body for every module's operations and channels (socket, http and installation read it) |
| `graph/core/Blocks.ts` | 874 | split (F3, F4 gate): `contract/service/blocks.ts` (L153–251); `blocks/birth.ts` (L42–151, L590–686: create); `blocks/update.ts` (L395–585); `blocks/edit.ts` (L688–776); `blocks/guards.ts` (L269–393); `blocks/law.ts` (L778–871: `setEnabled`, `setEnforcement`, applying the enforced-law contract) | `Blocks` stays the service name |
| `graph/projects/repo.ts` | — | **dissolves** by subject (§7.6): `identifyProject`, `ProjectIdentity` → **`projects`** `projects/identity.ts` (7.5.2 (b)); the checkout readings `checkoutAt`, `checkoutsOf`, `standsAside`, `CallerCheckout`, `CallerCheckoutState`, `RepoCheckout`, `RepoWorktree` → **`workspace`** `workspace/checkouts/git.ts` (7.5.6 (b)) | added in v4: v3 named the split only in the receivers |
| `graph/core/Edges.ts` | 248 | `blocks/linking.ts` (one subject: the `Edges` service — linking, unlinking and their declaration gate) | F3 cleared by the stem (`edges.ts` over 200 lines would keep the one-word plural F3 measures) |
| `graph/core/Trash.ts` | 118 | `blocks/trash.ts` | — |
| `graph/core/History.ts` | 322 | `blocks/history.ts` | — |
| `graph/core/bodyDiff.ts`, `bodyFile.ts` | 395 | `blocks/bodyDiff.ts`, `blocks/bodyFile.ts` | — |
| `graph/core/Tags.ts` | 549 | split by its two subjects: `vocabulary/declarationRules.ts` (L91–434: reading a declaration and its gates — `declaringTag`, `bodyCap`, `validateFields`, `assertComposable`, required fields, field reads, `declarationOf`, `unreadableParts`, `assertDeclaration`); `vocabulary/tagTable.ts` (L435–549: the `Tags` service, its process cache and `tagsLayer`, where L466–489 is the discard P0's barrier replaces) | F3: a directory change alone would not clear it (`vocabulary/tags.ts` stays a one-word plural stem over 200 lines); the two subjects are real, and each file is under 400 |
| `graph/core/tagProjection.ts` | 100 | `vocabulary/projection.ts` | — |
| `graph/core/Catalogs.ts` | 91 | `vocabulary/catalogs.ts` | — |
| `graph/core/installCatalogs.ts` | 171 | `vocabulary/install.ts` | shipped content and its base (`catalogBase`, from catalogs' `contract/wire/base.json`) arrive as catalogs' argument; the `import base from './catalogBase.json'` (L17) goes |
| `graph/core/Ranking.ts`, `searchIndex.ts`, `stem.ts` | 469 | `search/ranking.ts`, `search/words.ts`, `search/stem.ts` | — |
| `graph/core/Selection.ts` | 567 | `search/selection.ts` | one subject (the query language and its reads); F4 watch |
| `graph/core/wire.ts` | 116 | `reading/rows.ts` | domain rows → contract shapes |
| `graph/core/settingBlocks.ts` | 38 | `measure/settingBlocks.ts` | the doctor's setting-driven set |
| `graph/core/orcaProfile.ts` | 179 | → **`executions`** (territory correction, §7.6) | a first-run import of `terminal.*` keys |
| `graph/core/Graph.ts` | 109 | `graph.ts` (assembly surface) | `GraphServices`, `graphLayer` |
| `graph/core/graphFixture.ts`, `worldCost.probe.ts` | 515 | composition's test world | it assembles graph with projects, settings and platform; `DemoOwners` → `DemoServices` |

*Journal and serving (`graph/journal`, `graph/projects`, `http/`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `graph/journal/Journal.ts` | 310 | `journal/reads.ts` | F1 cleared; `Journal` stays the service |
| `graph/journal/GraphFeed.ts` | 175 | `journal/feed.ts` | `dumpMachineRegistry` (installation) replaced by installation's subscriptions to `registryChanged`, `settingsChanged` and this module's `projectPolicyChanged` |
| `graph/projects/MeasuredCheckout.ts`, `ServedTree.ts` | 26 | `contract/service/serving.ts` | — |
| `graph/projects/blockNames.ts` | 85 | `reading/names.ts` | — |
| `graph/projects/git.ts` | 95 | → **`platform`** `git/readings.ts` (territory correction, §7.6) | tolerant git readings; installation's builds and source cut read them too |
| `graph/projects/workingSet.ts` | 15 | `work/standingCondition.ts` | — |
| `http/GraphPool.ts` | 500 | `serving/pool.ts` | `CallerContext` (http) → platform's `Actor` plus graph's lens; `BranchTwins`, `TwinUnfollowed` (worktrees) → worktrees calls graph's `followBranch` (the edge turns); `ThreadRowMark` removed (change-record's `heldChanged`) |
| `http/GraphRouting.ts` | 234 | `serving/routing.ts` | — |
| `http/MirrorBuilder.ts` | 685 | split (F4 gate): `serving/open.ts` (L53–276, L604–684: build and fill); `serving/writeThrough.ts` (L278–346); `serving/attach.ts` (L348–603: registry sync, mirror travel, knowledge probe, attach and the serving switch) | `MirrorBuilderOwner` → tag `MirrorBuilder`; `mirrorHolds`' `'foreign'` → `'other-project'` (S7; in-memory); the change-record discharge wiring and `headObserver` removed (change-record discharges on workspace's `headMoved`) |
| `http/ServingSwitch.ts` | 212 | `serving/checkout.ts` | which checkout serves a project, storage moves |
| `http/FreshnessGate.ts` | 204 | `serving/freshness.ts` | `FreshnessGateOwner` → `FreshnessGate`; watches through workspace's watcher API (E1) |
| `http/treePermits.ts` | 52 | `serving/permits.ts` | the rank-400/420 declarations |

*Tree files (`files/`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `files/BlockFile.ts`, `BlockTree.ts`, `TreeScan.ts`, `exportGraph.ts` | 495 | `tree/blockFile.ts`, `tree/layout.ts`, `tree/scan.ts`, `tree/export.ts` | — |
| `files/Mirror.ts` | 551 | `tree/mirror.ts` | F4 watch; local `foreign` → `other` |
| `files/GraphFileSync.ts` | 338 | `tree/projection.ts` | — |
| `files/TreeCommits.ts` | 204 | `tree/commits.ts` | `HeadObserver` (change-record) removed as above |
| `files/TreeLedger.ts`, `freshness.ts`, `TopologyMirror.ts`, `Conflicts.ts` | 403 | `tree/ledger.ts`, `tree/freshness.ts`, `tree/topology.ts`, `tree/conflicts.ts` | — |
| `files/GraphChanges.ts` | 89 | `tree/branchChanges.ts` | its types from `contract/wire/branchChanges.ts` |
| `files/StorageLayout.ts`, `StorageMove.ts` | 177 | `storage/layout.ts`, `storage/move.ts` | — |
| `files/JournalMigration.ts`, `LegacyTree.ts`, `legacyShape.ts` | 331 | `tree/migrations/journal.ts`, `tree/migrations/legacyTree.ts`, `tree/migrations/legacyShape.ts` | `migrateJournalFloor` → `migrateJournalOffTree` (S7); the `meta` keys stay |
| `files/serveLogBound.ts`, `serveRecord.ts` | 125 | → **`composition`** (territory correction, §7.6) | the running server's own record |

*Measurement (`graph/measure`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `graph/measure/Doctor.ts` | 1,460 | split (F4 gate): `contract/service/measure.ts` (L87–143); `measure/doctor.ts` (L147–382: layers and the run pass); `measure/remeasure.ts` (L384–451); `measure/seeds.ts` (L453–598); `measure/closure.ts` (L682–883); `measure/scan.ts` (L885–1201); `measure/queue.ts` (L600–666, L1302–1460: the standing queue, reconcile, helpers) | — |
| `graph/measure/MeasureDrain.ts` | 283 | `measure/drain.ts` | F2 cleared |
| `graph/measure/SweepWatermark.ts` | 303 | `measure/sweepMark.ts` | — |
| `graph/measure/measure.worker.ts`, `measureThread.ts` | 191 | `measure/worker.ts`, `measure/offThread.ts` | F2 cleared |
| `graph/measure/checks/*` (13 files) | 1,245 | `measure/checks/*`, names kept | `ownerSpread.ts`' S1-watch name stays |
| `graph/measure/imports/*` (2 files) | 63 | `measure/imports/*` | — |
| `graph/measure/Sources.ts` | 1,257 | split (F3, F4 gate): `contract/service/sources.ts` (L42–225); `sources/reads.ts` (L237–371, L895–908, L1235–1254); `sources/placement.ts` (L406–544, L921–995, L1110–1121: place, detach, attach, unanchor, take-over); `sources/relocation.ts` (L373–404, L997–1108); `sources/verification.ts` (L556–677, L1123–1233: readying, verify, unverify); `sources/ownership.ts` (L679–893) | `FileOwner`, `BlockOwner` are graph's code-owner sense (glossary "owner"), types, not DI tags: kept; the S3 entry is closed as a false signal in the snapshot |
| `graph/measure/sources/*` (9 files) | 916 | `sources/readers/*`, names kept | — |

*Orientation and work (`graph/orientation`, `graph/work`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `graph/orientation/Orientation.ts` | 1,219 | split (F1, F4 gate): `orientation/law.ts` (L47–307: the law forest); `orientation/prime.ts` (L198–226, L390–697: map reading, sections, render); `orientation/instructions.ts` (L699–757 with `Instructions.ts`); `orientation/sessionStart.ts` (L759–839 with `sessionStart.ts`); `orientation/briefs.ts` (L848–1216: review, spec-writing and work briefs) | `Orientation` stays the service; doctrine sections (threads) and the hook budget (external-harnesses) arrive as arguments |
| `graph/orientation/Instructions.ts`, `sessionStart.ts` | 239 | merged as above | — |
| `graph/orientation/Reading.ts` | 412 | `reading/block.ts` | F4 watch |
| `graph/orientation/Touches.ts` | 444 | `orientation/touches.ts` | `agentNames` → the `SessionNames` port; F3 cleared |
| `graph/orientation/Digest.ts`, `map.ts`, `tagPrompts.ts` | 484 | `orientation/digest.ts`, `orientation/map.ts`, `orientation/tagPrompts.ts` | — |
| `graph/work/Amendments.ts` | 509 | `work/amendmentOps.ts` (one subject: the ops a proposal or a batch document carries, their handles and refusals, and the `Amendments` service applying them) | F3 cleared by the stem; F4 watch (509) stays a signal |
| `graph/work/Batch.ts` | 416 | `work/batch.ts` | `OPERATIONS`, `OperationId` (composition) → platform's brand plus the list handed in as an argument |
| `graph/core/BatchSources.ts` | 83 | `work/batchFiles.ts` (the files a batch document and its bodies are read from and written to: `read`, `body`, `write`) | `BatchSources` → `BatchFiles`, `BatchSourceError` → `BatchFileError` ("source" is the graph's word for a claim's evidence, section 5); **added in v3** — v2's map missed this file |
| `graph/work/Reflection.ts` | 493 | `work/reflections.ts` | `FiledReflection.receivedBy` (L40–45) is typed by platform's `ProcessProvenance`; the value arrives as a layer argument (`receivedBy`), passed by `composition` from installation's `measureProvenance` — as it reaches `Graph.ts`, `http/GraphPool.ts` and `http/MirrorBuilder.ts` today through `protocol/source.ts` |
| `graph/work/Review.ts` | 903 | split (F4 gate): `work/proposals/filing.ts` (L33–86, L194–482); `work/proposals/verdicts.ts` (L484–761); `work/proposals/listing.ts` (L763–900) | `Review` stays the service |
| `graph/work/Tasks.ts` | 771 | split (F3, F4 gate): `work/tasks/holding.ts` (L45–69, L193–211, L444–548); `work/tasks/ending.ts` (L355–441, L550–669); `work/tasks/specs.ts` (L213–352); `work/tasks/divergence.ts` (L671–767) | `Tasks` stays the service |
| `graph/work/Standing.ts` | 150 | `work/supersession.ts` | the file replaces blocks; "standing" is the resting sense |
| `graph/work/lifecycle.ts`, `retirement.ts` | 99 | `work/lifecycle.ts`, `work/retirement.ts` | — |

*Operations, voice, wire, CLI:*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `operations/blocks.ts`, `crossing.ts`, `orientation.ts`, `work.ts` | 1,116 | `operations/blocks.ts`, `operations/crossing.ts`, `operations/orientation.ts`, `operations/work.ts` | — |
| `operations/answers.ts` | 54 | `operations/answers.ts` | `ToolBlock`, `ToolBlockResult`, `ToolChecked` (native-harness) → graph's own answer types `BlockAnswer`, `BlockResultAnswer`, `CheckedAnswer` on platform's envelope |
| `operations/measure.ts` | 422 | `operations/measure.ts` | `read_installation_status` (L186–204) → external-harnesses, its **one owner** (section 1 §1.3: "what Tagma installs into each CLI"), with its skill, workflow and hook status reads; its `conflicts` field is read through graph's served-tree service over the registry's `external-harnesses → graph` relation, and `installation` owns no part of it (its `status` verb is the orientation verb and never called this operation); the hook ledger in `read_gauges` → the gauge hook |
| `operations/nativeJournal.ts` | 82 | `journal/callRange.ts` | `journalRange`, and `landedByCall` → **`recordedByCall`** as a journal service; its answer types `ToolJournalRange` → `CallJournalRange`, `ToolLanded` → `CallRecorded`, answer field `landed` → **`recorded`** (section 5 §5.4.8: "sync" names the phase, the journal answer is `recorded`). A **same-build rename** of producer and readers, landed in `native-harness`'s wave with its readers (`operations/nativeTools.ts` L234–245, `projection/toolAnswer.ts` L304–310); the reader keeps reading `landed` in stored results. Graph's wave moves the file under the old names if it comes first |
| `operations/projects.ts` | 275 | split: `read_owners`, `sync_graph` → `operations/projects.ts`; `heldTasks` → `work/tasksHeld.ts`; `submit_work` → landing; `handoverOf`, `landingPlace` → change-record; settings bodies → settings; MCP bodies → mcp | `ServingGit` (executions) becomes an argument of `landingPlace`, which leaves |
| `projection/blockPage.ts`, `evidence.ts`, `tags.ts`, `zonePage.ts` | 280 | `voice/blockPage.ts`, `voice/evidence.ts`, `voice/tags.ts`, `voice/zonePage.ts` | — |
| `projection/lines.ts` | 156 | `voice/lines.ts`; `submitLines`, `judgedLines` (L78–128) → landing's voice; `sourceLine` → installation's voice; `refusalLines` → platform's voice kit (executions renders refusals with it, below graph) | `SubmitReceipt` and the enforcement violation types leave with them |
| `protocol/operations/graph.ts` | 1,715 | split (F4 gate) into `contract/wire/operations/`: `shared.ts` (L17–140), `reads.ts` (L141–296, L369–546 without `read_installation_status`, which goes to external-harnesses), `measure.ts` (L298–367, `verify_block`, `unverify_block`, `anchor_block`, `unanchor_block`, `reanchor_path`), `writes.ts` (L548–775, `link_blocks`, `unlink_blocks`, `delete_block`, `restore_block`), `work.ts` (L777–1003, `apply_batch`, L1098–1279, `supersede_block`, `unsupersede_block`), `reflections.ts` (`file/answer/unanswer_reflection`), `tree.ts` (`sync_graph`, `resolve_graph_conflict`); `submit_work` → landing; `read_installation_status`'s declaration → **external-harnesses** `contract/wire/operations.ts` (its one owner; v3 still named installation here) | — |
| `protocol/batch.ts`, `query.ts`, `fields.ts`, `edges.ts`, `sources.ts`, `findings.ts`, `remedies.ts`, `references.ts`, `journal.ts`, `graphFeed.ts`, `instructions.ts`, `lifecycle.ts`, `blocks.ts`, `reads.ts` | — | `contract/wire/` as in 3 | `lifecycle.ts` reads the `OperationId` brand from platform's `ids.ts`; F5 entries are watch |
| `protocol/identity.ts`, `protocol/rows.ts` | — | `contract/wire/identity.ts`, `contract/wire/rows.ts` | `spokenId` → **`platform`** `contract/wire/ids.ts`; `Writer` → **`platform`** `contract/service/writers.ts` as `WriterRef` |
| `protocol/text.ts` | 10 | → **`platform`** `contract/wire/text.ts` (§7.6: `trimmed`, a neutral schema helper) | — |
| `protocol/files.ts` | 7 | `contract/wire/pathExists.ts` — stays graph's: the report of graph's `read_path_exists` (v4's correction to workspace withdrawn, review B2) | — |
| `protocol/reports.ts` | 180 | `contract/wire/reports.ts`; the install states and hook-ledger shapes (L44–110 part) → external-harnesses | — |
| `protocol/storage.ts` | 5 | `contract/wire/storage.ts`, whole; `CHECKOUT_DIRECTORY` → `GRAPH_DIRECTORY` (stays graph's; `workspace`, `change-record` and `sandbox` receive it as the `graphDirectory` argument `composition` passes, 7.5.6) | `CHECKOUT_DIRECTORY` → `GRAPH_DIRECTORY` |
| `protocol/source.ts` | 36 | split by meaning (§7.6; the launcher's adjudication, both files reread whole by the launcher): `SourceCut`/`sourceCutSchema` (L3–8: `startedAt` = the process's `performance.timeOrigin`, `revision {head, dirty}` of the checkout it runs from) → **platform** `contract/wire/provenance.ts` as `ProcessProvenance`/`processProvenanceSchema` — which running process and build recorded something; `InstallationCut`, `Source`, `Restart`, `restartAsk` (L10–36) → **installation** `contract/wire/source.ts` | graph consumes the provenance value, it does not own it |
| `protocol/law.ts`, `protocol/records.ts` | 16 | deleted, if still unimported at M1 | task [[ab2192df]] |
| `protocol/tags/TagTable.ts`, `roles.ts`, `shape.ts` | 485 | `contract/wire/tags/table.ts`, `roles.ts`, `declaration.ts` | F2 cleared |
| `cli/commands/blocks.ts` | 41 | `cli/blocks.ts`, declared in `cli.ts` | written against platform's verb contract |
| `cli/commands/orientation.ts` | 50 | `law` → `cli/law.ts`; `status` → **`installation`** (§7.6) | — |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `graph/projects/Projects.ts` (projects; remainder stays at that path after W1) | the birth's root block and catalog installation, `ensureVocabulary`, `servesFrom`, `measureNotice` | `serving/birth.ts` (C2 coordinator of project birth with `Projects.register`) |
| same | `zoneByPlace`, `scopeByPlace`, `relativePlace`, `placeOf`, `ownersOf`, `scope`, `lens` | `serving/scope.ts` |
| same | `set` (policy), `setStorage`, `purgeProject`'s graph rows, `ForeignGraphs` → `OtherGraphs`, `PROJECT_SETTING_CHECKS`, `GraphRole`, the live-knowledge removal check | `serving/policy.ts` (`project_policy`), `serving/removal.ts` (`RemovalHold`) |
| `graph/core/Settings.ts` (settings; remainder stays) | `CatalogGraph`, the `catalogWrites` permit, the catalog-writer path of `land`, the `decides` re-measure, `vocabulary.publish(held)`, `CommitHooks` in `onCommit` | `vocabulary/settingsReaction.ts` (the `ManagedWrite` contribution and the decided-settings reaction) |
| `graph/projects/Sessions.ts` (platform) | `inProject` | `journal/sessions.ts` |
| `files/ShadowGit.ts` (platform) | the shadow repository, `gitIdentity` | `tree/shadow.ts` |
| `protocol/caller.ts`, `protocol/refusal.ts`, `operations/currentProject.ts` (platform; the last corrected to graph) | `Lens`, `NameReach`, `ProjectCall`, `CurrentProject`, `CallerRefusal`, `OpenRefusal`, `ReferenceRefusal`, `ServingRefusal`, the served-project resolution | `contract/wire/call.ts`, `serving/current.ts` |
| `protocol/projects.ts` (projects) | the policy names | `contract/wire/storage.ts` |
| `protocol/pageFamilies.ts` (platform) | `BLOCKS`, `TASKS`, `REFLECTIONS`, `PROPOSALS`, `FINDINGS`, `GAUGES`, `EVENTS` | `contract/wire/operations/shared.ts` |
| `graph/projects/holders.ts` (workspace) | `heldTasks`, `HeldTask` | `work/tasksHeld.ts` |
| `protocol/worktreeFinishing.ts` (landing) | `GraphChanges`, `GraphKindChanges` | `contract/wire/branchChanges.ts` |
| `protocol/toolResult.ts` (native-harness) | `ToolReflectionFiled` (L200–207) | `contract/wire/reflections.ts` as `ReflectionFiled`; its text and display join graph's reflection voice, contributed by manifest to every tool voice |
| `protocol/settings.ts` (settings) | the `graph`-owned keys of 7.5.3 | `contract/wire/settings.ts` |

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `socket/graphChannel.ts` (socket, §7.6) → the graph feed in `journal/feed.ts`, declared in graph's manifest (K3)
- from `http/wire.ts` (http, §7.6) → `voice/written.ts` (block-write and batch-outcome answers)
- from `doctrine/sections/` (threads, 7.5.20): `aimingARead.ts`, `blockReferences.ts`, `general.ts`, `graphEvidence.ts`, `graphReading.ts`, `graphRefusals.ts`, `graphWriting.ts`, `review.ts`, `scopeBrief.ts`, `theCheckoutAndTheGraph.ts`, `theLongLivedBranch.ts`, `whatTagmaIs.ts` → `graph/doctrine/<same stem>.ts`, contributed through the doctrine hook (ids unchanged)
- from `protocol/numbers.ts` (platform, 7.5.1): `SEARCH_TERM_MIN`, `EVENTS_PAGE_SIZE`, `OWNER_SPREAD_AREAS`, `ZONE_PAGE_BUDGET`, `TOUCH_INLINE_BUDGET`, `SESSION_START_BYTES`, `PROMPT_CONTEXT_CHARS`, `SESSION_START_MAP_CHARS`, `MODEL_OUTLINE_ROWS`, `UNCOVERED_NAMED_PATHS` → beside its one reader, in the file of this card's (a) that reads it
- from `cli/commands/files.ts` (change-record, corrected in §7.6): the `log` and `resolve` verbs → `graph/cli/files.ts`, declared in `graph/cli.ts`

*(c) Symbols renamed:* `TreeFloor` → `TreeGuard`, `TreeFloorFaces` → `TreeGuardFaces`; `GraphTransaction` → `ActState`; `ForeignGraphs` → `OtherGraphs`; `migrateJournalFloor` → `migrateJournalOffTree`; `MirrorBuilderOwner` → `MirrorBuilder`; `FreshnessGateOwner` → `FreshnessGate`; `DemoOwners` → `DemoServices` (composition); `ToolBlock` → `BlockAnswer`, `ToolBlockResult` → `BlockResultAnswer`, `ToolChecked` → `CheckedAnswer`, `ToolJournalRange` → `CallJournalRange`, `ToolLanded` → `CallRecorded` (with `landed` → `recorded`, the same-build rename of section 5, landed in native-harness's wave; graph's own voice; native-harness keeps what its tools render). Frozen: every table and column, event op names, finding check names, `meta` keys, storage mode literals, the `.tagma` directory.

*(d) Leaves:* `orcaProfile.ts` → executions; `serveLogBound.ts`, `serveRecord.ts`, `graphFixture.ts`, `worldCost.probe.ts` → composition; `protocol/source.ts` (split: provenance → platform, installation cut and restart → installation), the `status` verb → installation; `sourceLine` (`projection/lines.ts` L144–148, the text of a provenance, read by graph's reflections, installation's CLI and the tool voice) → platform's `provenance.ts` as `provenanceLine`; `read_installation_status` and the install-state and hook-ledger shapes → external-harnesses; `refusal.ts`, `git.ts`, `text.ts`, `refusalLines` → platform;  `catalogBase.json` (the shipped base `installCatalogs.ts` merges against; not a `.ts` file, so not in the snapshot) → catalogs; `submit_work`, `submitLines`, `judgedLines` → landing; `handoverOf`, `landingPlace` → change-record; settings and MCP operation bodies → settings and mcp; `graph/work/enforcement.ts` is already enforcement's by territory.

**9. Debt retired.**
- `modules` (appendix B, consumer `graph`): `graph → enforcement` (10) by the enforced-law contract as an argument; `graph → cli` (8) by platform's verb contract; `graph → external-harnesses` (5) by the hook budget argument and the gauge hook; `graph → threads` (5) by doctrine sections as an argument and `ThreadRowMark` removed; `graph → landing` (4) by `submit_work` leaving and `GraphChanges` becoming graph's; `graph → change-record` (4) by the discharge callback removed and `handoverOf`/`landingPlace` leaving; `graph → catalogs` (2) by content as an argument; `graph → composition` (2) by platform's `OperationId`; `graph → http` (2) by `Actor` plus lens; `graph → native-harness` (2) by graph's own answer types; `graph → mcp` (2); `graph → installation` (1) by the `registryChanged` subscription; `graph → worktrees` (1) by the edge turning; `graph → executions` (1) with `landingPlace`. Door edges into graph are the doors'.
- `names`: F4 gate — `Act.ts` (824), `Blocks.ts` (874), `Doctor.ts` (1,460), `Sources.ts` (1,257), `Orientation.ts` (1,219), `Review.ts` (903), `Tasks.ts` (771), `MirrorBuilder.ts` (685), `protocol/operations/graph.ts` (1,715); F3 — `Blocks.ts`, `Edges.ts`, `Tags.ts`, `Sources.ts`, `Touches.ts`, `Amendments.ts`, `Tasks.ts`; F1 — `Journal.ts`, `Orientation.ts`; F2 — `MeasureDrain.ts`, `measure.worker.ts`, `measureThread.ts`, `TagTable.ts`; S7 — `TreeFloor`, `TreeFloorFaces`, `migrateJournalFloor`; S3 — `FileOwner`, `BlockOwner` (closed as false: glossary sense, not DI). F4 watch and F5 entries are signals.

**10. Graph work.**
- The zone [[5940edc1]] "The block graph" becomes `#module` `graph`, `dir` `apps/tagma/server/src/graph`, `depends-on` `projects`, `settings`, `workspace`. Its areas stay by meaning: [[867d7671]], [[4792affd]], [[3e2134a2]], [[f91a1b40]], [[e49bba5a]], [[3ce532a9]], [[85d8c4b8]], [[211bdc2e]], [[57f1e49a]]; [[0c6877fb]] (test fixture) goes to composition with its file.
- [[fe468405]] "The projects a machine serves": registration claims went to projects (7.5.2), coverage claims to workspace (7.5.6); the serving, scope, ownership and policy claims re-hang under a new area "Serving a project's graph" with [[e2120e99]], [[1d4f8769]], [[4ad9b8a3]], [[6d66e566]], [[c3dc0e11]], [[12793beb]], [[42427635]], [[35b74b1e]].
- [[84e7cf4e]] "The graph as files a repository carries" becomes graph's `tree` area; [[298493d0]] (files beside the database) splits: the legacy lift here, the rest by its owners; [[a115687f]] (the record a running server leaves) goes to composition.
- The parts of the layer zones that describe graph code — [[3dbd3b23]] "What an operation actually does", [[70b217f6]] "What a reader is shown", [[19aec648]] "The vocabulary every caller speaks", [[fe6b3580]] "The operations table", [[8ec9c71c]] — re-hang their graph claims here (§8.7 step 5); their other claims go to each owner's card.
- Re-anchored at M1 (the splits): every claim over `Act.ts`, `Blocks.ts`, `Doctor.ts`, `Sources.ts`, `Orientation.ts`, `Review.ts`, `Tasks.ts`, `MirrorBuilder.ts`, `protocol/operations/graph.ts` moves to the part holding its symbol; task [[68203367]] closes into the `Act.ts` split.
- Tasks absorbed or kept: [[8b6c8faa]], [[090b1af1]], [[8735ec76]], [[48bd3866]], [[c52434fd]], [[dec93933]], [[45d60e0a]] close into the zone the wave writes, or re-hang if the wave does not write their claims; open defects [[7d43b0ee]], [[9674ea21]], [[327289e6]] re-hang with their code and must not be broken; [[ab2192df]] closes with the two deletions.
- Rules standing under [[5940edc1]] at watch or gate move only through `enforce_rule` with the operator's approval if the area dissolves; here it becomes the module, so they stay where they are.

**11. Acceptance.**
1. `graph/` imports only `platform`, `projects`, `settings` and `workspace`; zero `modules` and `names` debt (the S3 false signal closed in the snapshot).
2. D1: a server opening a store or tree whose format is newer serves reads and refuses every write and catalog install, naming both formats. D2: an act that dies after commit and before landing is landed by the recovery driver at boot, never twice; `conflicted` is resolved by `resolve_graph_conflict`.
3. A freshness repair reads only the watcher's named paths; a rescan is logged as recovery with its cost; a polling tree says so.
4. Every graph route answers through a generated operation endpoint, and the new read operations of 7 answer pages with `limit`, a derived default and ceiling, and a total (rule [[68659e3b]]).
5. `remove_project` refuses while a block, source, edge or ref stands, through graph's `RemovalHold`.
6. The touch brief names the other writers through `SessionNames`; without the binding it answers ids and says so.
7. Split files keep their behaviour: the graph suite runs green on the split before any rename lands.

**12. Risks.**
- **Size.** 148 files, nine F4 splits. The wave splits in three merges: M1 the contract (wire, services, `call.ts`) and the file moves without splits; M2 the splits, one file per change, each re-anchoring its claims; M3 the renames and the zone. A builder never splits and renames in one change.
- **`Act.ts` is the ring's centre** (claim [[8fdd798b]]: measure and commit hooks close back onto the act through references with inert defaults). The split keeps the references and their inert defaults in `contract/service/acts.ts`, so no import cycle forms between `acts/` and `measure/`.
- **`MirrorBuilder` and `GraphPool` hold process state** (the synced-registry map, entries, gates, releases, the changes LRU). Moving them must keep one instance per process; the pool test that opens, evicts and reopens a tree runs at M2.
- **Early M1 matters.** Nine modules read graph's call contract. If M1 slips, `change-record`, `enforcement`, `landing` and the doors wait; the builder extracts `contract/` before anything else.
- **`D1`/`D2` are data changes on every served tree.** They run at open, before admission, with the old-writer refusal in place; the restart test kills an act between commit and landing.

### 7.5.8 `catalogs`

**1. Ownership.** The vocabularies Tagma ships, as content handed to the graph (section 1 §1.3). Directory `catalogs/`. It owns no glossary word: "catalog" (the installed declaration) and "tag" are graph's; this module owns the **shipped content** and its ids.

**2. Wave.** W3, level 5. Opens after graph M1 (it needs only graph's declaration schema); runs alone. Carries section 9's shipped content (its catalog changes land here as content) and the argument binding: composition hands `CATALOGS` to graph's installation and to settings' `graph.catalogs` key declaration at `start`. `installation` opens at its M1.

**3. Offers.**
- `contract/wire/registry.ts` — `CATALOGS`, `CATALOG_IDS`, `CatalogId`, `catalogById`, `catalogsDeclaring`, `collidingTags`, `tagsOfCatalogs`.
- `contract/wire/codeProject.ts`, `contract/wire/notes.ts` — the two shipped catalogs as data (`codeProject`, `notes`). They live in `contract/wire/` because they are pure, browser-safe declarations the app may show.
- **Arguments given (bound at `start` by composition):** the shipped catalog set and its `catalogBase` (`contract/wire/base.json`) to graph (`vocabulary/install.ts`, `blocks/birth.ts`), to settings (the allowed values of `graph.catalogs`), and the default ids to installation.
- No services, no events, no manifest entries beyond the module itself.

**4. Needs.** `graph` — type: the declaration schema (`Catalog`, `Tag` from `contract/wire/tags/declaration.ts`), `DEPENDS_ON` (`contract/wire/edges.ts`) and `SOURCE_KINDS` (`contract/wire/sources.ts`).

**5. Tables.** None. **6. Lanes, resources, passes.** None. **7. Operations.** None; `read_tags` and catalog installation are graph's.

**8. Target file map.**

*(a) Files whose primary owner is `catalogs`* (3 TypeScript files, 230 lines, and one data file received in (b)):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `protocol/tags/catalogs.ts` | 28 | `catalogs/contract/wire/registry.ts` | — |
| `protocol/tags/codeProject.ts` | 141 | `catalogs/contract/wire/codeProject.ts` | section 9's content changes land in this file |
| `protocol/tags/notes.ts` | 58 | `catalogs/contract/wire/notes.ts` | — |

*(b) Parts received:* **`graph/core/catalogBase.json`** (graph's directory; not a `.ts` file, so absent from the territory script's snapshot) → **`catalogs/contract/wire/base.json`**: the shipped tags each catalog is compared against when no installed revision is recorded (`installCatalogs.ts` imports it at L17 and decodes it at L19; `previousTags` falls back to it at L118). It travels with the catalog set as part of catalogs' argument — `catalogBase` beside `CATALOGS` — handed by `composition` to graph's `vocabulary/install.ts`, which no longer imports a JSON file by path. *(c) Symbols renamed:* none; catalog ids and tag ids are data. *(d) Leaves:* nothing.

**9. Debt retired.** `modules`: none has `catalogs` as consumer — its imports of `graph` are allowed. The edges **into** it that the argument binding removes are other cards': `graph → catalogs` (2: `Blocks.ts`, `installCatalogs.ts`, retired in graph's wave) and `settings → catalogs` (`protocol/settings.ts`: `CATALOGS`, `CATALOG_IDS`, `collidingTags`, retired when the `graph.catalogs` key moves to graph's keys and takes the set as an argument). `names`: none.

**10. Graph work.** Claims [[01de8089]] and [[2ddf00b9]] re-anchor to the new paths at M1; the claims about what a catalog **is** stay under graph's vocabulary area [[4792affd]], and the zone of this module holds only the claims about the shipped content (which catalogs ship, how their guidance is written). `#module` `catalogs`, `dir` `apps/tagma/server/src/catalogs`, `depends-on` `graph`.

**11. Acceptance.**
1. `catalogs/` imports only graph's `contract/wire/`; nothing below `catalogs` imports it.
2. A new project is born with the same catalog set as before, and `write_setting graph.catalogs` refuses an unknown id as before, both reading the set through the argument.
3. The app's vocabulary pages still render the shipped catalogs from `contract/wire/`.

**12. Risks.** The graph and settings waves must switch to the argument **before** this module moves, or they import a path that is gone; the builder moves the three files with the import rewrite in one change, and the argument binding lands in graph's and settings' waves (this wave's M1 waits on graph M1 anyway).

### 7.5.9 `installation`

**1. Ownership.** This installation of Tagma: its data directory, builds, succession, registry file, setup and restore (section 1 §1.3). Directory `installation/`. Glossary words owned: **installation** (a verified closure of Tagma's parts), **closure**, **release** (cutting one), **succession** (a server handing over to its successor), **data directory**, **registry file** (`registry.json`). It is also the **installation lifetime** of section 1 rule 7: a lifetime owners contribute services to, never the owner of accounts, host clients or performance.

**2. Wave.** W3, level 6. Opens after projects, settings, graph, providers and catalogs M1; runs alone. Carries the registry file and the restore coordinator (section 2 §2.4.9 as amended by section 1 §1.13: participants `projects`, `settings`, `graph`), the registry export on every change of those three, the **downgrade preflight** (section 5 §5.4.8) and the console-key rollback (`providers`), `vacuum_database`, D8's volume inputs (the store and snapshot sizes the budgets read), the succession and setup hooks, and K2 for the health routes. `artifacts` and `executions` open at its M1.

**3. Offers.**
- `contract/wire/layout.ts` — part, file and directory names, revision labels and timing (from `protocol/installation.ts`), the frozen part paths (from `protocol/frozen.ts`). `TAGMA_VERSION`, `TAGMA_*` environment names are external names and stay (S2 exemption).
- `contract/wire/manifest.ts` — `InstallationRole`, `REQUIRED_ROLES`, `CLOSURE_LAYOUT`, `InstallationPart`, `InstallationPlatform`, `InstallationIdentity`, `InstallationOrigin`, `InstallationManifest`, the refusals `InstallationMissing`, `InstallationInvalid`, `InstallationMismatch`, `InstallationUnreadable`, `InstallationRefusal` (boundary names keep their domain word, §7.4.2).
- `contract/wire/machine.ts` — the machine state answer (← `protocol/machineStanding.ts`; "standing" as a status snapshot → **state**, section 5): `MachineState`, `MachineAct`, `serverStateSchema`, `hostStateSchema`, `CheckoutBuildState`, `BuildFrom`, `BuildThen`, `buildAskSchema`, `BuildStep`, `BuildRunning`, `BuildEnded`, `HostReplaceWhen`, `RunningExecution`, `hostHoldingsSchema`. The host shapes stay here as the succession hook's contract: executions fills them.
- `contract/wire/source.ts` — the installation cut, `Source` (a process's provenance and its installation cut) and the restart shapes (← `protocol/source.ts` L10–36, graph); `Source.cut` is typed by platform's `ProcessProvenance`.
- `contract/service/provenance.ts` — `measureProvenance` (← `measureSource`, `http/sourceCut.ts`): the producer that measures this process's `ProcessProvenance` once at start; `composition` hands the value to graph (reflection receipts, the served-graph pool, the mirror builder) as an argument.
- `contract/wire/status.ts` — `storeSizeSchema`, `vacuumSchema`, `vacuumRefusal` (← `protocol/database.ts`, §7.6).
- `contract/service/` — `paths.ts` (`installationAnchor`, the database path, install root, launcher and seed directory, from the environment; handed to `platform` and `workspace` as arguments at `start`), `closure.ts` (`readInstallation`, `verifyInstallation`, the current installation), `registry.ts` (the registry file and restore coordinator), `succession.ts` (`Succession`), `builds.ts` (`CheckoutBuilds`, frozen builds), `downgrade.ts` (the downgrade to an older binary: the **preflight step hook** `DowngradeSteps` — each step closes what it admits and confirms it is drained, or refuses — and the rollback participant role).
- **Hooks declared (start-bound):** **setup steps** ← external-harnesses (installing into the machine's CLIs); **succession steps** ← executions (host replacement when a build succeeds). A step not bound is named in the answer, never skipped silently.
- **Participant roles it coordinates — three separate contracts:**
  1. **Registry restore into an empty store** — `projects` (registrations), `settings` (setting rows), `graph` (`project_policy`), in one machine unit. No other participant: `providers` writes nothing here.
  2. **Downgrade preflight** — the `DowngradeSteps` hook, start-bound. `enforcement` fills it with the commit queue's step: installation asks it to **close queue admission**, then to confirm **`waiting = 0` and `unread = 0`**; any other answer refuses the downgrade before the binary switches, because the old reader skips an unknown line with a warning and loses its commit (`enforcement/CommitQueue.ts` `loaded`, L34–66).
  3. **Console-key rollback** — after the preflight passes, `providers` writes the console keys from its credential file into the **copy** of the snapshot the previous binary opens, in the column that binary reads (section 1 §1.13). Never part of restore.
- **Subscriptions:** `registryChanged` (projects), `settingsChanged` (settings) **and graph's post-commit `projectPolicyChanged`** (a change of `strict_provenance`, `private` or `storage` alone) rewrite `registry.json` after commit (replacing `dumpMachineRegistry` in `GraphFeed`, which today dumps from the graph feed, `MachineRegistry.ts` `dumpMachineRegistry` L70–84, shape L20–33).
- **Manifest:** its operations, its CLI verbs, the claim of the data directory.

**4. Needs.** `platform` (store open, snapshots, durable files, capacity inputs); `projects`, `settings`, `graph` (restore participants; `graph` also its `projectPolicyChanged` event); `providers` (the console-key rollback participant only); `enforcement` fills `DowngradeSteps` (a hook this module declares — no import upward); `catalogs` (type: the shipped ids for a new project's default set). Nothing above: the host binary, the CLI installs and the server launcher arrive through hooks and arguments.

**5. Tables.** None of its own. It writes `project` and `setting` only through their owners' participants in one machine unit (restore); today `MachineRegistry.ts` inserts the rows directly — that is the cut of this wave. `registry.json` is a durable file (platform's `durable` kit), rewritten after the rows it mirrors change.

**6. Lanes, resources, passes.** The data-directory claim (a pid file; one server per directory) is a process-lifetime resource declared here. Checkout builds run as a detached process group with a tracked record (`build.json`) that survives restarts; their orphan reap at boot is a declared recovery pass (rule [[a00f91b0]]). Succession holds one asking permit. The serve log is composition's (7.5.7 (d)).

**7. Operations.** `vacuum_database` (`read_installation_status` is external-harnesses': it reads the CLI installs). Typed routes (K2): `GET /health` stays a plain route (the liveness probe every client and the placeholder page poll; section 4 keeps health outside the operation table); `POST /restart` → new `restart_server`; `GET /api/health/standing` → new `read_machine_state`; `POST /api/health/build` → new `build_checkout`; `POST /api/health/build/stop` → new `stop_build`; `POST /api/database/vacuum` → `vacuum_database`. CLI verbs: `restart`, `build`, `update`, `web`, `desktop`, `install`, `upgrade` (the CLI installs run through the setup hook), `status` (from graph); `serve` stays with composition and the door (section 1 §1.6.3); `auth` leaves for `providers`.

**8. Target file map.**

*(a) Files whose primary owner is `installation`* (22 files, 3,841 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `install/closure.ts` | 424 | split: `contract/wire/manifest.ts` (L7–168); `closure/read.ts` (L170–348: read, verify, prove, walk); `closure/write.ts` (L350–424) | F4 watch and F5 end |
| `install/standing.ts` | 31 | `closure/current.ts` | `Standing` → `CurrentInstallation`, `readStanding` → `readCurrent` (section 5 "standing") |
| `install/carried.ts` | 15 | `closure/carried.ts` | — |
| `files/FrozenDirectory.ts` | 62 | `closure/versions.ts` | the version directories and the `current` link |
| `install/launcher.ts` | 176 | `setup/launcher.ts` | `installationBin` → `binDirectory` (private) |
| `installationPaths.ts` | 29 | `contract/service/paths.ts` | — |
| `graph/projects/MachineRegistry.ts` | 190 | `registry/file.ts` (L15–94: shape, dump) and `registry/restore.ts` (L96–190: restore through the participants, `openMachineRegistry`, `machineStoreLayer`) | direct inserts into `project` and `setting` replaced by participants (5) |
| `operations/database.ts` | 18 | `operations/vacuum.ts` | with `projection/database.ts` (§7.6) as `voice/vacuum.ts` |
| `http/claim.ts` | 66 | `process/claim.ts` | — |
| `http/succession.ts` | 190 | `process/succession.ts` | `hostReplaceWhen` and the host replacement become the succession hook executions fills |
| `http/sourceCut.ts` | 17 | `contract/service/provenance.ts` | `measureSource` → `measureProvenance`, answering `ProcessProvenance` (platform) |
| `http/checkoutBuilds.ts` | 533 | `builds/checkout.ts` | one subject (a checkout build run and its record); F4 watch |
| `http/FrozenBuilds.ts` | 41 | `builds/frozen.ts` | the `http` import (the builds wire) becomes `contract/wire/machine.ts` |
| `http/surfacePlaceholder.ts` | 54 | `builds/placeholder.ts` | — |
| `install/cut/release.ts`, `build.ts`, `try.ts`, `beside.ts` | 1,157 | `cut/release.ts`, `cut/build.ts`, `cut/try.ts`, `cut/beside.ts` | scripts; the server `package.json` scripts `build` and `try` follow the paths; `releaseInstallation` keeps its name (boundary). Their CLI helpers come from platform's verb contract |
| `protocol/installation.ts`, `protocol/frozen.ts` | 75 | `contract/wire/layout.ts` | — |
| `protocol/machineStanding.ts` | 138 | `contract/wire/machine.ts` | renames in 3; the custody literal `'foreign'` → `'other'` changes in **`executions`**' wave with the CLI's operator output (7.5.14 (b)) |
| `cli/commands/setup.ts` | 603 | split by verb (F4 gate): `cli/server.ts` (L150–223 restart and the standing helpers of L20–136, plus `status` from graph); `serve` (L138–148) → composition; `cli/builds.ts` (L225–369: build, update); `cli/clients.ts` (L371–465: web, desktop); `cli/setup.ts` (L548–603: install, upgrade, calling the setup hook); `auth` (L467–546) → `providers/cli/auth.ts` | declared in `installation/cli.ts`; the server launcher is an argument |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `protocol/database.ts` (platform) | `storeSizeSchema`, `vacuumSchema`, `vacuumRefusal` | `contract/wire/status.ts` |
| `projection/database.ts` (platform, corrected to installation in §7.6) | `vacuum_database`'s voice | `voice/vacuum.ts`, contributed in installation's manifest with the operation: the answer schema (`vacuumSchema`), its text (`vacuumText`) and its display (today native-harness's `projection/toolAnswer.ts` L427–435), so no tool voice imports installation |
| `protocol/source.ts` (graph) | the installation cut and restart shapes (L10–36); the provenance part (L3–8) goes to platform | `contract/wire/source.ts` |
| `cli/commands/orientation.ts` (graph) | the `status` verb (L30–50) | `cli/server.ts` |
| `projection/lines.ts` (graph) | `sourceLine` | `voice/source.ts` |
| `protocol/operations/process.ts` (performance) | the `vacuum_database` declaration (L82–99) | `contract/wire/operations.ts` |

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `doctrine/sections/` (threads, 7.5.20): `wiringARepository.ts` → `installation/doctrine/<same stem>.ts`, contributed through the doctrine hook (ids unchanged)
- from `protocol/numbers.ts` (platform, 7.5.1): `DEFAULT_PORT`, `SURFACE_DEV_PORT`, `ARTIFACT_PORT` → beside its one reader, in the file of this card's (a) that reads it

*(c) Symbols renamed:* `MachineStanding` → `MachineState`; `StandingAct` → `MachineAct`; `serverStandingSchema` → `serverStateSchema`; `hostStandingSchema` → `hostStateSchema`; `CheckoutStanding` → `CheckoutBuildState`; `Standing` → `CurrentInstallation`; `readStanding` → `readCurrent`. Frozen: `registry.json`'s shape, every file and directory name of the closure, `TAGMA_*` variables, `build.json`.

*(d) Leaves:* the `auth` verbs → providers; `install/machineWorld.ts` is executions' by territory (the host machine as an execution world; installation hands it the carried binary as an argument).

**9. Debt retired.**
- `modules` (consumer `installation`): `installation → cli` (15: `setup.ts`, `beside.ts`, `build.ts`, `try.ts`) by platform's verb contract and the launcher argument; `installation → external-harnesses` (3: `setup.ts`, `build.ts`) by the setup hook; `installation → executions` (2: `succession.ts`, `build.ts`) by the succession hook; `installation → composition` (1: `setup.ts`) by the launcher argument; `installation → http` (1: `FrozenBuilds.ts`) by the builds wire moving here. Edges into it (`platform`, `graph`, `workspace`, `change-record` → installation) are cut by the paths becoming arguments, in those cards.
- `names`: `cli/commands/setup.ts` F4 gate (603); the rest are signals (`closure.ts` F5, `Installation*` F2-style words kept as boundary names).

**10. Graph work.**
- The area [[c0f69bd1]] "What an installation of Tagma is" becomes the zone of `#module` `installation` (`dir` `apps/tagma/server/src/installation`, `depends-on` `projects`, `settings`, `graph`, `providers`, `catalogs`), with [[a064e631]] and [[4240c0c4]] re-anchored.
- Claim [[92a549da]] (`install/` stands in two floor entries) is rewritten when the floor rule's emptied entries go (§7.2.6); until then it is re-anchored to the new directory's floor entry.
- The succession, claim and build files are owned today only by the doors' layer areas [[e2262db0]], [[0075ecae]]; their claims come here. Decision [[2aa71f01]] (one press updates Tagma) and claim [[8ee50ca5]] stay related: the checkout build run is its code.
- `MachineRegistry.ts`' claims under [[fe468405]] come here.

**11. Acceptance.**
1. `installation/` imports only its needs; zero `modules` debt; `setup.ts` is gone.
2. Restoring `registry.json` into an empty store writes registrations, settings and graph policy through the three participants in one machine unit; a participant that fails rolls the whole unit back; no credential is read or written.
3. `registry.json` is rewritten after every commit that changes a registration, a setting row or a project policy — a change of `strict_provenance`, `private` or `storage` alone reaches the dump — and never from a stale read.
3a. A downgrade across the commit queue's format is refused while the queue holds a waiting or an unread line, and after the preflight closes admission no line is appended; the console-key rollback writes only into the snapshot copy, and only after the preflight passes.
4. A successful build with the succession hook bound replaces the host as today; without it, the answer names the unbound step.
5. `tagma:build` and `tagma:try` run from the new paths.

**12. Risks.**
- **Restore order at boot.** Restore runs before admission and needs the three participants' store code, which lives in lower modules; installation's `start` must run after theirs. The composition order is the registry order, so this holds by construction; the restore test runs on an empty store.
- **The cut scripts run outside the server** (`bun run build`/`try`); a path move that forgets the package script breaks the operator's update. The builder changes the script entries in the same change and runs `tagma:build --verify` once.
- **Succession across the wave.** A server built from the new layout must still hand over to and from one built from the old; the successor protocol (`TAGMA_REPLACES`, the standing-by signal) is unchanged by this wave.

### 7.5.10 `change-record`

**1. Ownership.** Who wrote which line of a checkout, which lines each session still holds, and the change those lines make (section 1 §1.3). Directory `change-record/`. Glossary words owned: **change** (a recorded write: typed or observed), **held lines**, **authorship**, **discharge** (a change released because HEAD carries it), **prepared change** (the change a session would land), **observation** (a shell command seen to move a path).

**2. Wave.** W4, level 4. Opens after projects, settings, thread-record and workspace M1; runs beside `graph`. Carries the **prepared change** and its lease (section 4 K4: the one implementation `submit_work` and `check_rules` read), discharge on workspace's `headMoved` (graph's `discharge` callback removed — section 1 §1.15 item 8), the `heldChanged` event (replacing `markHeld`/`ThreadRowMark`), the authorship reads (`read_changes`, `read_authorship`, `ThreadFiles`' attribution — item 6), and K2 for the change routes. `enforcement` and `landing` need its M1.

**3. Offers.**
- `contract/wire/` — `authorship.ts` (lines with authors and spans, path answers, staged and unstaged sides); `threadFiles.ts` (the thread frame from `protocol/checkoutStatus.ts` L99–147: `ThreadFile`, `ThreadFileState` ← `ThreadFileStanding`, `ThreadCommit`, `ThreadCommitLimit`, `ThreadFileList`, `THREAD_COMMITS`); `changes.ts` (the `read_changes` answer: rows, holders, observations); `operations.ts` (`read_changes`, `read_authorship`, `strip_comments`, `record_write`).
- `contract/service/` — `record.ts` (`ChangeRecord` ← `WorkspaceChangesOwner`: record a typed or observed write, the version texts, held rows, holders); `prepared.ts` (`PreparedChanges`: the session's prepared change and its lease — new); `threadFiles.ts` (`ThreadFiles` ← `ThreadFilesOwner`); `sweep.ts` (`StripComments` ← `StripCommentsOwner`).
- **Ports declared:** **carrier admission** ← implemented by `threads` (which session may carry which lines into a landing; section 1 §1.4.3); **`HeldTaskLabels`** (`contract/service/taskLabels.ts`) ← implemented by `graph` from `work/tasksHeld.ts`, called for all `read_changes` rows, including reads of another session's path (review B3).
- **Hooks filled (workspace's):** `CommitOverlay` (the paths a thread delivered in a commit — today `CommitStamps`), `CheckoutWriters` (who wrote a path), `CheckoutHolders` (who holds a tree's lines; graph adds their tasks).
- **Events:** `heldChanged(threadId, rootId)` → threads (the thread row's held count), socket.
- **Subscriptions:** workspace `headMoved` (discharge); thread-record `phasePublished` (run-end marks, replacing native-harness' `ThreadState` subscription).
- **Manifest:** tables, layer, operations, the discharge pass, the pending-op recovery pass.

**4. Needs.** `platform` (units, git kit, the private index); `projects` (key-ref: project key); `settings` (record and sweep settings); `thread-record` (identity, lineage, principal, phase and `running_run_id`); `workspace` (working place proof, `headMoved`, `PlacedPath`, the checkout row types, `opensBinary`). The graph storage directory arrives as the layer argument `graphDirectory`, passed by `composition` from graph's `GRAPH_DIRECTORY` (section 1: `change-record → graph` is an argument, no relation).

**5. Tables** (machine store; names kept): `workspace_change`, `workspace_change_content`, `workspace_observation`, `workspace_write_refusal`. `project_id` keys `project` through projects' contract; its rows name threads by id with no foreign key (`db/changes.ts` imports no thread table), so D4 does not touch them; readers join through `thread_record` after D4. New: the prepared change's lease row (section 4 K4's shape; this wave's migration).

**6. Lanes, resources, passes.** The discharge look (background, on `headMoved`; section 3 table), the pending-op replay (recovery: hook writes and tool changes kept as JSON when the store refused them, replayed at boot — rule [[a00f91b0]]), the frontier alignment step budget (`walkBudget`), the authorship LRU cache with its byte budget (a D8 budget declared here). The prepared change holds platform's private index under the commit lane's rank. From accepted [[9c085c6c]] (§3.13.13 E3, this wave): the measurement flights, the recording queue and its reader barrier, and W12 (§3.13.10).

**7. Operations.** `read_changes` (from threads), `read_authorship`, `strip_comments`; new `record_write`. Typed routes (K2): `GET /api/changes` → `read_changes`; `POST /api/changes/record` → `record_write` (a hook's reported write); `POST /api/changes/submit` → `submit_work` (landing); `GET /api/checkouts/:rootId/authorship` → `read_authorship`; `POST /api/files/comments/strip` → `strip_comments`. CLI: none (the `files` verbs are graph's, 8 (d)).

**8. Target file map.**

*(a) Files whose primary owner is `change-record`* (17 files, 5,168 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `db/changes.ts` | 134 | `store/tables.ts` | `witnessKey`, `WorkingRoot` from workspace's contract; `project` from projects' |
| `harness/WorkspaceChangeLog.ts` | 1,736 | split by subject (F4 gate, F5 39): `record/places.ts` (L57–129: place predicates); `record/write.ts` (L131–495: row shapes, inserts, the log port, `ChangeRecord`); `record/sessions.ts` (L497–560, L1498–1554: agent resolution and handover); `record/reads.ts` (L562–889: counts, thread history, versions, held rows, thread and project reads); `record/holding.ts` (L891–1056, L1279–1386, L1556–1591: outstanding, covering, holders and trees, write guards, held paths); `record/evidence.ts` (L1058–1277); `record/observations.ts` (L1388–1496); `record/stamping.ts` (L1593–1734: origin adoption, stamping, withdrawal, `dischargeRecord`) | `WorkspaceChangeLog` → `ChangeLog` (the port), `WorkspaceChangeRow` → `ChangeRow`, `WorkspaceChangesOwner` → tag `ChangeRecord`; `runningRunOf`, `runningRunsOf`, `descends` read thread-record's facts and lineage instead of `thread`, `thread_run`; `agentNames` → `SessionNames` via thread-record's `facts`; `namedHolders` keeps the task labels for every `read_changes` row through change-record's `HeldTaskLabels` port filled by graph, while landing reads that graph service separately |
| `harness/ThreadFiles.ts` | 1,355 | split by subject (F4 gate): `threadFiles/failures.ts` (L72–180); `threadFiles/rows.ts` (L490–605, L908–1040: the live list's hold, subscribe, read, marks and cycles); `threadFiles/listing.ts` (L182–276, L1042–1239: list helpers and building); `threadFiles/patch.ts` (L278–488); `threadFiles/authorship.ts` (L607–732, L796–906); `threadFiles/weigh.ts` (L1241–1355); `pictureAt`, `workingBytes`, `Picture`, `PICTURE_CAPTURE`, `pictureType` (L734–794 and helpers) → workspace (7.5.6) | `ThreadFilesOwner` → tag `ThreadFiles`, the class → private `Files`; `ThreadRowMark` (threads) → `heldChanged`; the root-admission refusals (worktrees) → workspace's; attaching the list to a thread row → threads (territory) |
| `files/attribution.ts` | 271 | `lines/attribution.ts` | — |
| `files/changeFrontier.ts` | 337 | `lines/frontier.ts` | — |
| `files/replay.ts` | 236 | `lines/replay.ts` | F5 signal |
| `files/zzWalkBudget.scratch.ts` | 44 | deleted | a scratch benchmark with no reader; a builder who wants it keeps it as `lines/frontier.bench.ts` |
| `files/discharge.ts` | 358 | `record/discharge.ts` | `HeadObserver`, `headObserver` (L281–358) removed: the subscription to `headMoved` replaces them; `watchingHead` (workspace) gone; `CHECKOUT_DIRECTORY` → the `graphDirectory` argument; shadow git → platform's git kit |
| `files/pendingChanges.ts` | 159 | `record/pending.ts` | `installationAnchor` → the pending directory as an argument |
| `files/stripComments.ts` | 179 | `sweep/stripComments.ts` | `StripCommentsOwner` → tag `StripComments`, `StripCommentsFace` → `StripCommentsFaces` |
| `harness/checkoutRunMarks.ts` | 36 | `record/runMarks.ts` | subscribes to `phasePublished`; `ThreadState` (native-harness) gone |
| `operations/authorship.ts` | 34 | `operations/authorship.ts` | `CheckoutReadOwner` → `CheckoutReads` |
| `operations/files.ts` | 56 | `operations/sweep.ts` | — |
| `protocol/authorship.ts` | 31 | `contract/wire/authorship.ts` | — |
| `protocol/operations/authorship.ts`, `protocol/operations/files.ts` | 127 | `contract/wire/operations.ts` | with `read_changes` and `record_write` |
| `cli/commands/files.ts` | 58 | → **`graph`** (territory correction, §7.6): `graph/cli/files.ts` | `log` reads a block's file history and `resolve` concludes a graph merge: both are the tree's |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `protocol/checkoutStatus.ts` (workspace) | the thread frame (L99–147) | `contract/wire/threadFiles.ts` |
| `graph/projects/holders.ts` (workspace) | the holders-of-lines part of `namedHolders` | `record/holding.ts`, as the `CheckoutHolders` contribution |
| `worktrees/CheckoutReads.ts` (workspace) | `CommitStamps` | `record/overlay.ts` (the `CommitOverlay` contribution) |
| `operations/projects.ts` (graph) | `handoverOf`, `landingPlace` (L49–118 part) | `prepared/place.ts` (the thread's git runner is an argument) |
| `protocol/operations/session.ts`, `operations/session.ts` (threads) | `read_changes` (L598–637; L604–739) | `contract/wire/operations.ts`, `operations/changes.ts` |
| `http/handlers/changes.ts` (http) | the `record` handler body (L110–133) | `operations/record.ts` |
| new | the prepared change and its lease (section 4 K4) | `prepared/change.ts`, `contract/service/prepared.ts` |

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `socket/changesChannel.ts` (socket, §7.6) → `record/feed.ts`, declared in change-record's manifest
- from `doctrine/sections/` (threads, 7.5.20): `theSharedCheckout.ts` → `change-record/doctrine/<same stem>.ts`, contributed through the doctrine hook (ids unchanged)
- from `harness/submitWork.ts` (landing, 7.5.18): `changeSubject`, the carrier selection and the tree build → `prepared/subject.ts`, `prepared/carriers.ts`, `prepared/tree.ts` (the prepared change K4 reads)
- from `protocol/pageFamilies.ts` (platform, 7.5.1): `CHANGES` → `change-record/contract/wire/pages.ts`

*(c) Symbols renamed:* `WorkspaceChangesOwner` → `ChangeRecord`; `WorkspaceChangeLog` → `ChangeLog`; `WorkspaceChangeRow` → `ChangeRow`; `ThreadFilesOwner` → `ThreadFiles` (tag); `StripCommentsOwner` → `StripComments`; `StripCommentsFace` → `StripCommentsFaces`; `ThreadFileStanding` → `ThreadFileState`; `CommitStamps` → `CommitOverlay`. Frozen: the four table names and their columns, refusal codes (`staged-elsewhere`, `lines-held`, `lines-retired`), the pending-op file names.

*(d) Leaves:* the picture read → workspace; the list attachment → threads; `cli/commands/files.ts` → graph; the task labels of a landing → landing.

**Task labels in `read_changes`** (review B3): every row `read_changes` answers carries `tasks`, for any path read (`protocol/evidence.ts` L427–436; `operations/session.ts` L659–665, L723–737), filled today through `namedHolders` (`WorkspaceChangeLog.ts` L499–519, L616–645, L1225–1275) from graph's store (`graph/projects/holders.ts` L47–80, L82–106). The card keeps that contract: change-record declares the port **`HeldTaskLabels`** (`contract/service/taskLabels.ts`: the tasks each holder holds, for a set of holders), used by every `read_changes` read; **graph fills it** at `start` from `work/tasksHeld.ts`; until `graph M1` it is bound to today's `heldTasks` (§7.2.7). Landing's task labels are a separate consumer of the same graph service and replace nothing here.

**9. Debt retired.**
- `modules` (consumer `change-record`): `change-record → graph` (9: `changes.ts`, `discharge.ts`, `stripComments.ts`, `ThreadFiles.ts` +2) by the `graphDirectory` argument, projects' key and the `HeldTaskLabels` port graph fills; `change-record → cli` (3: `files.ts`, leaving for graph); `change-record → threads` (2) by `heldChanged`; `change-record → native-harness` (1: `checkoutRunMarks.ts`) by `phasePublished`; `change-record → worktrees` (1: `ThreadFiles.ts`) by workspace's refusals; `change-record → installation` (1: `pendingChanges.ts`) by the path argument.
- `names`: `WorkspaceChangeLog.ts` F4 gate (1,736), S3 `WorkspaceChangesOwner`; `ThreadFiles.ts` F4 gate (1,355), S3 `ThreadFilesOwner`; `stripComments.ts` S3 `StripCommentsOwner`. F5 entries are signals.

**10. Graph work.**
- The area [[372b147b]] "Who wrote which line of a shared checkout" becomes the zone of `#module` `change-record` (`dir` `apps/tagma/server/src/change-record`, `depends-on` `projects`, `settings`, `thread-record`, `workspace`).
- [[12972a3b]] "What a thread holds of the checkout" splits by section 1 §1.13: the record and authorship claims come here; working bindings go to workspace, landing to `landing`, workspace sources to native-harness, root preparation and the read witness to external-harnesses.
- Tasks: [[ef42cd77]] (landing fences no runs) re-hangs under `landing`, which owns the fence; [[8f04f442]] loses its record part into this zone.
- Claims over the two F4 splits re-anchor at M2 to the part holding their symbol.

**11. Acceptance.**
1. `change-record/` imports only its needs; zero `modules` and `names` debt.
2. A commit that carries a session's lines discharges them after `headMoved`, with no graph callback; a lost event is recovered by the next rescan's discharge look.
3. `submit_work` and `check_rules --over change` read one prepared change through `PreparedChanges`, and the same change yields the same verdict through both.
4. `read_commit` marks a thread's delivered paths through the overlay; `read_checkout` rows name holders with their tasks.
5. A run's end marks its trees through `phasePublished` within one event, as `checkoutRunMarks` does today.
6. Pending ops written while the store refused are replayed at boot and deleted once recorded.

**12. Risks.**
- **Two 1,500-line files, read on every write.** The splits keep every SQL statement byte-identical at M2; behaviour changes (thread-record reads, `SessionNames`) land at M3, one per change, each with the record's suite run whole.
- **The prepared change is new code** that two later modules wait on. Its contract lands at M1 as a service whose first implementation wraps today's `submitWork` preparation, so enforcement's `check_rules` can switch before the landing wave moves `submit_work`.
- **Discharge by event can miss a HEAD move** while the server is down. The boot pass and every rescan run the discharge look over the standing rows (today's `withdrawGone` and `dischargeCarried`), so a missed event delays and never loses a discharge.

### 7.5.11 `power`

**1. Ownership.** Keeping the machine awake while work runs, and the pace agents' processes run at (section 1 §1.3). Directory `power/` (kept). Glossary words owned: **awake mode**, **agent pace** (the pace value itself is the execution host's, `@runlith/executions/protocol/pace`).

**2. Wave.** W4, level 3. Opens after settings M1; runs beside W1–W3. Carries the `PaceDoor` port (declared here, implemented by `executions`, bound at `start` — section 1 §1.4.3; until `executions M1` bound to today's host producer, §7.2.7, review C1) and the settings keys `keepAwake` and `agentWork` moving from `protocol/settings.ts` into power's own key declarations (settings card, 7.5.3). `executions` needs its M1.

**3. Offers.** `contract/wire/power.ts` — `AWAKE_MODES`, `AwakeMode`, `DEFAULT_AWAKE_MODE`, `AGENT_PACES`, `AgentPace`, `DEFAULT_AGENT_PACE`, and the state shapes renamed below. `contract/service/awake.ts` (`AwakePolicy`, `AwakePolicyFaces`, `AWAKE_WORK_SOURCES`, `AwakeWorkSource`); `contract/service/pace.ts` (`AgentPaceFaces`, **`PaceDoor`** port). Events: the awake and pace states (sliding pubsubs today) → socket. Keys: `keepAwake`, `agentWork`.

**4. Needs.** `platform` (adapter: the sleep assertion's process), `settings` (service+event: its two keys). `executions` implements `PaceDoor`; `threads`' and the harnesses' work counts reach `AwakePolicy` through its service (they are above it).

**5. Tables.** None. **6. Lanes, resources, passes.** The sleep assertion is a child process (`caffeinate -i -w <pid>` on darwin; unavailable elsewhere, reported, never respawned); the pace retry every 30 s while the host refuses is a driven retry (rule [[a00f91b0]]: it is started by `holdAgentPace` at layer start). **7. Operations.** None today; the awake and pace states are pushed on the socket. Routes: none.

**8. Target file map** (4 files, 321 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `power/AwakePolicy.ts` | 104 | `power/awake.ts` | — |
| `power/SleepAssertion.ts` | 92 | `power/sleepAssertion.ts` | — |
| `power/AgentPace.ts` | 77 | `power/pace.ts` | `PaceDoor` moves to `contract/service/pace.ts` |
| `protocol/power.ts` | 44 | `power/contract/wire/power.ts` | renames below |

*(b) Parts received:* the keys `keepAwake`, `agentWork` from `protocol/settings.ts` (settings) → `power/keys.ts`. 

*Parts received by name (v5):*
- from `socket/live.ts` L80–82 and `socket/rpc.ts` L112–126 (socket): the `awake.subscribe` feed, served there directly today → declared and registered in power's manifest with its name and the shape of `awakeStandingSchema` unchanged (the symbol becomes `awakeStateSchema` by 7.5.11 (c); the wire does not change), before `socket M2` generates `rpc.ts` (review D1)

*(c) Symbols renamed* (section 5: a status snapshot is a **state**; the inner unions take their own subject to free the name): `AwakeState` (holding/released/unavailable/failed) → `SleepAssertionState`, `awakeStateSchema` → `sleepAssertionStateSchema`; `AwakeStanding` → `AwakeState`, `awakeStandingSchema` → `awakeStateSchema`; `PaceState` (handing/applied/unavailable) → `PaceHandover`, `paceStateSchema` → `paceHandoverSchema`; `PaceStanding` → `PaceState`, `paceStandingSchema` → `paceStateSchema`. Twenty sites read the two outer names (socket, the app); they change in this wave's M3, the schemas' wire shape unchanged. *(d) Leaves:* nothing.

**9. Debt retired.** `modules`: `power → settings` today goes through `graph/core/Settings.ts` and `protocol/settings.ts` — allowed after settings' W1 split, nothing to cut. The `settings → power` edge (7.5.3) is settings'. `names`: none at gate; `protocol/power.ts` F5 is a signal.

**10. Graph work.** Areas [[555f685a]] "How much of the machine agents' commands may take" and [[138cbf2b]] "Keeping the machine awake while work runs" become the zone of `#module` `power` (`dir` `apps/tagma/server/src/power`, `depends-on` `settings`). Task [[7504cf81]] (`install/` and `power/` stand on no floor) closes when `modules` covers `power/`.

**11. Acceptance.** `power/` imports only platform and settings; a thread starting work holds the assertion under `while-working` and releases it when the last count ends, as today; `PaceDoor` is bound from `power M1` to today's host producer (§7.2.7) and answers the pace the host applied, as today; only a test that withholds the binding sees `unavailable` with its reason.

**12. Risks.** The state renames swap the meaning of `AwakeState` in one wave: the builder renames the inner union first (M2) and the outer second (M3), each typechecked, so no site reads the wrong one.

### 7.5.12 `mcp`

**1. Ownership.** The MCP servers a project declares and the tools they offer (section 1 §1.3). Directory `mcp/` (kept). Glossary word owned: **MCP server** (a declared server and its pool). The client machinery is the `@runlith/mcp` package's.

**2. Wave.** W4, level 3. Opens after projects and settings M1. Carries the MCP operation bodies out of graph's `operations/projects.ts`, the key `mcpServers` into mcp's own declaration, and K2 for the MCP routes.

**3. Offers.** `contract/wire/servers.ts` — `McpServerRow`, `McpServerRowStatus`, `MCP_SERVER_STATUSES`, `mcpReachSchema`, `McpServerReach`. `contract/wire/operations.ts` — `add_mcp_server`, `remove_mcp_server`, `enable_mcp_server`, `read_mcp_servers`, `mcpScopeOf`. `contract/service/servers.ts` — `McpServers`, `McpServersFaces`, `McpServerWrite`, `McpAddRefusal`, `McpChangeRefusal`, `McpResolved` (the tools a native agent may call are read through it). Key: `mcpServers`.

**4. Needs.** `platform` (adapter: MCP client sessions, through `@runlith/mcp`); `projects` (key-ref: a server is declared for a registered project); `settings` (service+event: declarations, enabled state, `SettableScope`).

**5. Tables.** None (declarations are setting rows). **6. Lanes, resources, passes.** Per-project pools with a creation gate each; resolved secrets kept for redaction per pool. A user-scope write reconciles every open pool before it answers (task [[9fee39a8]]: the cost grows with open projects; this wave moves it, the task fixes it). **7. Operations.** The four above (names unchanged). Routes (K2): `GET /api/mcp` → `read_mcp_servers`; `POST /api/mcp` → `add_mcp_server`; `POST /api/mcp/remove` → `remove_mcp_server`; `POST /api/mcp/enabled` → `enable_mcp_server`.

**8. Target file map** (3 files, 653 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `mcp/McpServers.ts` | 423 | split (F2, F4 watch): `contract/service/servers.ts` (L16–73 faces and types); `mcp/declarations.ts` (L75–175: resolution, scope shadowing, rows, `${NAME}` references); `mcp/serverPool.ts` (L184–423: the pools, writes, reconcile, `mcpServersLayer`) | `makeMcpServers` → private; boundary names keep `Mcp` |
| `protocol/mcp.ts` | 51 | `mcp/contract/wire/servers.ts` | — |
| `protocol/operations/mcp.ts` | 176 | `mcp/contract/wire/operations.ts` | — |

*(b) Parts received:* `operations/projects.ts` (graph) L234–275 → `mcp/operations.ts`; the key `mcpServers` from `protocol/settings.ts` → `mcp/keys.ts`. 

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `doctrine/sections/` (threads, 7.5.20): `mcpServers.ts` → `mcp/doctrine/<same stem>.ts`, contributed through the doctrine hook (ids unchanged)

*(c) Symbols renamed:* none. *(d) Leaves:* nothing (`harness/mcpServerTools.ts` and `harness/mcpRule.ts` are native-harness' by territory).

**9. Debt retired.** `modules`: none with `mcp` as consumer. Edges into it cut elsewhere: `graph → mcp` (2) by the bodies moving here. `names`: `mcp/McpServers.ts` F2, cleared by the split.

**10. Graph work.** No area owns `mcp/` today: claim [[c1c25c61]] (the MCP vocabulary crosses to the browser through the declaration codec alone) and task [[9fee39a8]] hang elsewhere. The wave writes the zone of `#module` `mcp` (`dir` `apps/tagma/server/src/mcp`, `depends-on` `projects`, `settings`) from the code: scope shadowing, environment references and redaction, the pools' lifetimes; the claim and the task re-hang there.

**11. Acceptance.** `mcp/` imports only platform, projects and settings; the four operations answer as today through generated endpoints; a `${NAME}` missing from the environment is named in the row, never written into it.

**12. Risks.** Native agents reach the pools through `McpServers` from `harness/ThreadContext.ts` and `mcpServerTools.ts`; the M1 import rewrite covers them, and the pool per project stays one per process.

### 7.5.13 `artifacts`

**1. Ownership.** Pages the operator or an agent publishes, with their address and versions (section 1 §1.3). Directory `artifacts/` (kept). Glossary word owned: **artifact** (a hosted page, versioned).

**2. Wave.** W4, level 7. Opens after installation M1; runs beside `executions`. Carries K2 for the artifact list and the CLI verb's move onto platform's verb contract.

**3. Offers.** `contract/wire/artifacts.ts` — `ArtifactManifest`, `ArtifactRecord`, `ArtifactRow` (← `Artifact` of `api/artifacts.ts`, S2), `artifactId`. `contract/service/shelf.ts` — `ArtifactStore` (publish, list, page, versions). Manifest: the `artifacts` CLI verb, the `list_artifacts` operation.

**4. Needs.** `platform` (service: published bytes, versions); `installation` (service: the artifact shelf and serving base — `closure/versions.ts`' version-directory helpers, 7.5.9).

**5. Tables.** None: pages are versioned directories, 20 kept. **6. Lanes, resources, passes.** None. **7. Operations.** New `list_artifacts` (← `GET /api/artifacts`, K2). Serving a page's bytes stays an `http` route (`http/artifacts.ts`), because it answers a browser's page load, not an operation call.

**8. Target file map** (2 files, 198 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `artifacts/ArtifactStore.ts` | 165 | `artifacts/shelf.ts` | F2 cleared; `ArtifactStore` stays the boundary name |
| `cli/commands/artifacts.ts` | 31 | `artifacts/cli/list.ts`, declared in `artifacts/cli.ts` | reads `ArtifactRow` from its own wire |

*(b) Parts received:* `Artifact` (`api/artifacts.ts`, http) → `ArtifactRow`. *(c) Symbols renamed:* `Artifact` → `ArtifactRow`. *(d) Leaves:* nothing.

**9. Debt retired.** `modules`: `artifacts → cli` (3) by platform's verb contract; `artifacts → http` (1) by `ArtifactRow`. `names`: `ArtifactStore.ts` F2.

**10. Graph work.** The area [[d4be6dfe]] "The pages this server hosts" becomes the zone of `#module` `artifacts` (`dir` `apps/tagma/server/src/artifacts`, `depends-on` `installation`); the page-serving claims stay with `http`.

**11. Acceptance.** `artifacts/` imports only platform and installation; publishing keeps 20 versions and names pages as today; `tagma artifacts` lists newest first through `list_artifacts`.

**12. Risks.** None beyond the import rewrite: four native-harness files and five http files read `ArtifactStore`.

### 7.5.14 `executions`

**1. Ownership.** Commands and terminals Tagma runs on the execution host: admission, custody, input, command rules, worlds and reconciliation (section 1 §1.3; the module was `terminals`). Directory `executions/`. Glossary words owned: **execution** (a terminal or a bounded command the host runs), **terminal**, **command**, **command rule**, **command subject** (`CommandSubject`), **custody**, **lane**, **grant**, **view lease** (`ViewLeaseId`), **world** (where a thread's commands run), **host backend** (the host environment backend); the host wire's own words (`HostRequestKey`, `ScreenViewerId`, `ExecutionId`) are `packages/executions`' and `packages/execution-host`'s.

**2. Wave.** W4, level 7. Its **W2a store step** runs first: `command_rule`, `terminal`, `command`, `command_fence`, `command_wait`, `command_delivery` and the rest of `db/terminals.ts` leave `db/` into `executions/store/tables.ts`, because they reference `thread.id`. The wave opens after projects, settings, thread-record, workspace, installation and power M1; runs beside `artifacts`. Carries **D7** (the host wire range stamp, version-neutral hello, the carried v34 codec both ways, capability versions — section 2), the host environment backend (section 5 A3), `CommandOwner` → `CommandSubject`, `ViewerId` → `ViewLeaseId`, host `OperationId` → `HostRequestKey`, the custody literal `'foreign'` → `'other'` (section 5 §5.4.8), the terminal-adopter hook and the `NoticeTakeBack` port, and K2 for the terminal and command routes. `enforcement`, `performance`, `worktrees` and `sandbox` open at its M1.

**3. Offers.**
- `contract/wire/` — `targets.ts` (`TargetRoot`, `TargetIdentity`, `TargetKey`, `ResolvedExecutionTarget`, `AdmittedExecutionTarget`); `requestKeys.ts` (`TerminalMutation`, `TerminalOperationKey`, `OperationKeyRetention`, `TerminalOperationDigest`, `TerminalOperationAnswer`, `TerminalStartAnswer`, `TerminalOperationState`); `terminals.ts` (records, views, listing, waits, `TerminalIntent`, `TerminalQuarantine`, `InteractiveGrant`); `viewLeases.ts` (the socket vocabulary: `ViewLeaseId` ← `ViewerId`, screen and byte subscriptions, deliveries, input writes and receipts, grid reports, lanes, take-over answers, `recordStream.ts`' chunk schemas); `refusals.ts` (`TerminalRefused`, `TerminalUnavailable`, `TerminalIntentPending`, `staleIncarnation`, the host refusal sentences); `commands.ts` (views, lives, listings, selections, output readings, the command feed and its delta); `commandSubject.ts` (`CommandSubject` ← `CommandOwner`, `CommandSubjectKey`, `subjectKeyOf`, `subjectOfKey`, `principalOfSubject`); `commandRules.ts` (rules, reach, lists, time resolution, program rules, overlap, `COMMAND_RULES` page family); `hostState.ts` (the host's part of the machine state that installation's `contract/wire/machine.ts` types — see 8 (d)); `operations/terminals.ts`, `operations/commands.ts`, `operations/commandRules.ts`.
- `contract/service/` — `terminals.ts` (`Terminals` ← `TerminalsOwner`, `TerminalExecutions`, `TerminalFailure`, `TerminalStart`, `TerminalStartReceipt`); `commands.ts` (`CommandAccess`, `CommandOutput`, `CommandReader`, `CommandWaiters`, `CommandFeeds`, `admittedCommand`, the admitted-command capability `ProgramRoad` enforcement uses); `worlds.ts` (`Worlds`, `ThreadWorld`, `WorldFacts`, `WorldUnavailable`); `git.ts` (`ServingGit`: admitted git over the host, platform road as fallback); `rootExecutions.ts` (`StandingExecution`, `RootEnding`, `EndedExecution`: what stands in a root, for archive and merge — today typed in landing's and worktrees' files).
- **Implements:** `PaceDoor` (power); `EnvironmentBackend` for `host` (workspace); the succession step (installation: host replacement when a build succeeds).
- **Hooks declared (start-bound):** **terminal adopters** ← external-harnesses (a harness launch adopts its pty); **`NoticeTakeBack`** port ← implemented by `threads` (taking back a thread's ending notice beside discharging).
- **Events:** the command feed and inventory moves (→ socket), `commandEnded` (the ended queue → threads).
- **Keys:** the 40 `terminal.*` keys, `host.memoryShare`, `command.defaultMs` (settings card), and the Orca profile import (8 (b)).

**4. Needs.** `platform` (units, the execution client, durable intent, `Actor`, `ActorRef`, `Principal`); `projects` (key-ref); `settings` (terminal, host and command keys); `thread-record` (the custody subject's identity, liveness and phase; `TerminalThreads` reads it); `workspace` (participant: root uses and environment uses in one unit; `FileRoots`, `Coverage`, `EnvironmentAccess`, `TargetAt`, `ProvedRoot`); `installation` (the installed host bundle, the carried ripgrep, the state directory anchor); `power` (`PaceDoor`, declared there).

**5. Tables** (machine store; names kept unless noted): `command_rule`; `terminal_operation`, `terminal_operation_tally`, `terminal_intent`, `terminal`, `terminal_writer`, `command`, `command_fence`, `command_wait`, `command_delivery`, `custody_notice`. The W2a store step moves them first; D4 re-points their thread keys at `thread_record` (this module is a participant). Section 5 §5.4.6 renames the durable effect rows to **intent**, merging `terminal_operation` into `terminal_intent` only if this card finds them one record. They are two: `terminal_intent` holds an effect's phases and mutation, `terminal_operation` holds the request keys a caller names, their outcomes and retention. So `terminal_operation` → **`terminal_request_key`** and `terminal_operation_tally` → **`terminal_request_key_tally`** (the glossary's "request key"), renamed by copy-drop-rename in this wave's M3 migration, with the tally triggers recreated and the whole-store foreign-key check (section 2 §2.10 rollback); `read_terminal_operation` keeps its operation name (a catalog name, not a table). The `db/landedReports.ts` migration report becomes a contribution to the store's report registry (7.5.1).

**6. Lanes, resources, passes.** Declared resources: live grants capped at 512 with 1,024 ended runs remembered; live view leases capped at 256, one screen frame in flight each; the command output reader positions LRU at 4,096; the inventory cells with one flight semaphore; the terminal grids' resize lane; the grant close retries. Passes (each started at layer start — rule [[a00f91b0]]): the endings watch re-opened at boot, request-key retention (recount, reclaim, forget), disposition and disown of gone threads and removed projects, the host share follow, the custody warnings. The host boot adopts, raises or defers at start (`TerminalHostBoot`, `hostPreflight`). Lifetimes: a thread's world is a per-context lease (`Worlds`).

**7. Operations.** Owned (names unchanged): the fifteen terminal operations (`read_terminals`, `read_terminal`, `read_terminal_operation`, `read_terminal_screen`, `read_terminal_bytes`, `wait_terminal`, `read_terminal_processes`, `read_terminal_ports`, `start_terminal`, `write_terminal`, `interrupt_terminal`, `resize_terminal`, `transfer_terminal`, `signal_terminal`, `stop_terminal`), the seven command operations (`read_commands`, `read_command`, `read_command_bytes`, `read_output`, `wait_command`, `change_command_limit`, `stop_command`), and `write_command_rule`, `remove_command_rule`, `read_command_rules`. `read_terminal_operation` keeps its name as a wire name of the catalog (section 5 §5.4.6 lists no rename for it). Typed routes (K2): the 18 routes of `api/terminals.ts`, the 8 of `api/commands.ts` and the 3 of `api/commandRules.ts` map onto these operations one to one where the catalog has the act; the operator-only acts the catalog lacks become new operations named by their act (`replace_host`, `read_host_report`, `open_terminal_lane`, `close_terminal_lane`, `report_terminal_grid`), each reviewed against section 5's grammar before the wave opens. CLI verbs: `terminal` (`replace-host`), `command` (`bytes`), `execution-host` (the recovery road with no server).

**8. Target file map.**

*(a) Files whose primary owner is `executions`* (79 files, 19,815 lines). Paths below are relative to `executions/`.

*Terminals (`terminals/`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `terminals/Terminals.ts` | 2,649 | split by subject (F1, F3, F4 gate): `contract/service/terminals.ts` (L116–235); `terminals/start.ts` (L236–661: start, reserve, launch, dispatch, unwind, accept, starter and pipe lanes, and, of the helpers at L2438–2649, only those only start calls — `unwitnessed` (L2454–2460), `targetOf`, `commandRefusal`, `commandOwnerThread`, `creatorPrincipal`, `commandOriginOf`, `commandLaunch` (L2557–2637). Every other helper of that range goes with the part that calls it, by the author's grep of their call lines: `takeOverRefusal` → `custody.ts`; `laneRefused`, `mayHaveLeft` → `input.ts`; `ended`, `lostState` → `reads.ts`; `replacedReceipt` → `stops.ts`; `TerminalDischarge`, `sweepKeyOf` → the retirement part; and the four used by several parts — `sameRef`, `refKey` (execution-ref identity), `threadOf`, `agentLaneKey` (a principal's thread and lane) — → `terminals/refs.ts`. `HOST_INVENTORY_PAGES` has no reader in the file; the builder confirms and drops it. `start.ts` is then about 515 lines — one lifecycle under F4's gate, so **no allowance is needed**; v3's 638 came from taking the whole helper range); `terminals/reads.ts` (L663–1048: request-key reads, inventory, disposition, bytes and screens); `terminals/input.ts` (L1050–1351: the input gate, agent typing and lanes, bindings); `terminals/custody.ts` (L1357–1699: custody, transfer, take-over, state, waits, custody notices); `terminals/stops.ts` (L1701–1960: feeds, processes, ports, signal, stops); `commands/acts.ts` (L1962–2072: revise, wait, bytes of a command); `terminals/discharge.ts` (L2073–2434: retire, disown, endings and recovery, discharge, `TerminalDischarge`, `sweepKeyOf`) | `TerminalsOwner` → tag `Terminals`, the class → private `LiveTerminals` (S5: no `Manager` head word); its per-instance state (agent lanes, execution gates, moved pubsub, named survivors) stays on the one instance |
| `terminals/TerminalExecutions.ts` | 489 | `terminals/executionPort.ts` | F2 cleared; `TerminalExecutions` stays (boundary) |
| `terminals/TerminalGrants.ts` | 340 | `terminals/grants.ts` | `TerminalGrantsOwner` → tag `TerminalGrants` |
| `terminals/TerminalLanes.ts`, `ExecutionGrids.ts`, `TerminalWriters.ts`, `LiveViewers.ts` | 817 | `terminals/lanes.ts`, `terminals/grids.ts`, `terminals/writers.ts`, `terminals/viewLeases.ts` | `LiveViewers` keeps its name; `ViewerId` → `ViewLeaseId` |
| `terminals/TerminalAccess.ts`, `terminalPolicy.ts`, `terminalSubjects.ts`, `terminalAsk.ts` | 562 | `terminals/access.ts`, `terminals/policy.ts`, `terminals/subjects.ts`, `terminals/consent.ts` | `TerminalAccessOwner` → tag `TerminalAccess`; `TerminalStanding` → `TerminalState`; the dead producers of task [[46611756]] removed |
| `terminals/TerminalEndings.ts`, `TerminalReconciliation.ts`, `TerminalInventory.ts`, `TerminalTargets.ts`, `TerminalThreads.ts` | 805 | `terminals/endings.ts`, `terminals/reconciliation.ts`, `terminals/inventory.ts`, `terminals/targets.ts`, `terminals/threads.ts` | `TerminalTargetsOwner` → tag `TerminalTargets`; `TerminalThreads` reads `ThreadRecords.facts` instead of `thread` |
| `terminals/terminalEnvironment.ts`, `terminalRefusal.ts`, `terminalRetention.ts` | 287 | `terminals/environment.ts`, `terminals/refusal.ts`, `terminals/retention.ts` | F2 cleared |
| `terminals/endHeldExecutions.ts`, `rootExecutions.ts` | 252 | `terminals/endHeld.ts`, `terminals/rootExecutions.ts` | `StandingExecution`, `RootEnding`, `Unreachable` (landing's `WorktreeFinishing.ts`) and `EndedExecution`, `WorktreeUnavailable` (worktrees) become executions' own `contract/service/rootExecutions.ts`; archive and merge ask executions, never the reverse |

*Commands (`commands/`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `terminals/CommandAccess.ts`, `CommandOutput.ts`, `CommandReader.ts`, `CommandWaiters.ts` | 1,053 | `commands/access.ts`, `commands/output.ts`, `commands/reader.ts`, `commands/waiters.ts` | `CommandAccessOwner`, `CommandOutputOwner`, `CommandReaderOwner` → tags `CommandAccess`, `CommandOutput`, `CommandReader` |
| `terminals/commandEligibility.ts`, `commandPolicy.ts`, `commandSubjects.ts`, `commandCursor.ts`, `commandFeedReading.ts` | 873 | `commands/eligibility.ts`, `commands/policy.ts`, `commands/subjects.ts`, `commands/cursor.ts`, `commands/feed.ts` | the feed composition is task [[af5cabcb]]'s and [[ac856604]]'s ground; moved, not changed |
| `terminals/commandRules.ts` | 271 | `commands/rules.ts` | reads `thread` → `ThreadRecords` |
| `terminals/admittedCommand.ts`, `admittedGit.ts`, `servingGit.ts`, `endHeldCommands.ts` | 434 | `commands/admitted.ts`, `commands/admittedGit.ts`, `commands/servingGit.ts`, `commands/endHeld.ts` | `GitOwners` → `GitRoads` |
| `terminals/programRoad.ts` | 72 | `commands/programRoad.ts` | the program framing types (`ProgramLaunch`, `ProgramEnding`, `ProgramRoad`) move to executions' contract as the admitted-command capability; enforcement keeps the inspection framing (Astra C10) |

*Host (`host/`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `terminals/TerminalHostBoot.ts`, `TerminalHostCustody.ts`, `HostActivation.ts`, `ExecutionHost.ts` | 1,067 | `host/boot.ts`, `host/custody.ts`, `host/activation.ts`, `host/connection.ts` | F2 cleared; `hostStandingOf` → `hostStateOf` |
| `terminals/hostOffer.ts`, `hostPreflight.ts`, `hostRecovery.ts`, `hostReplacement.ts` | 1,131 | `host/offer.ts`, `host/preflight.ts`, `host/recovery.ts`, `host/replacement.ts` | `HostStanding` → `HostState`, `PreflightStanding` → `PreflightState` (section 5 "standing"); `hostReplacement` is the succession step installation calls |
| `terminals/executionPolicy.ts` | 74 | `host/policy.ts` | — |
| `workspaces/HostEnvironment.ts` | 145 | `host/environmentBackend.ts` | the `host` `EnvironmentBackend`; `installationAnchor` from installation's `paths` service |
| `terminals/hostFixture.ts`, `terminals/waitersFixture.ts` | 43 | `host/fixture.ts`, `commands/waitersFixture.ts` | test doubles of this module only (they assemble no other module) |

*Worlds (`worlds/`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `harness/worlds/Worlds.ts` | 202 | `worlds/cache.ts` | F1, F3 cleared; `Worlds` stays |
| `harness/worlds/ThreadWorld.ts`, `checkoutWorld.ts`, `managedWorld.ts`, `CommandLedger.ts` | 322 | `worlds/threadWorld.ts`, `worlds/checkout.ts`, `worlds/managed.ts`, `worlds/commandLedger.ts` | the ledger's `CommandOwner` → `CommandSubject` |
| `harness/worlds/commandWork.ts` | 819 | split (F4 gate): `worlds/shell/start.ts` (L55–217); `worlds/shell/stops.ts` (L219–458: cancellation, deadline moves); `worlds/shell/launch.ts` (L460–589); `worlds/shell/results.ts` (L598–819) | — |
| `install/machineWorld.ts` | 17 | `worlds/machine.ts` | the carried ripgrep from installation |

*Store, contract, operations, voice, CLI:*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `db/terminals.ts`, `db/commandRules.ts` | 243 | `store/tables.ts` (W2a) | `project` via projects' contract |
| `db/landedReports.ts` | 28 | `store/reports.ts` | contributed to the store's report registry |
| `terminals/TerminalStore.ts` | 1,766 | split by subject (F2, F4 gate): `store/requestKeys.ts` (L60–276, L447–546, L1498–1568: registration, reads, retention over `terminal_request_key`); `store/intentLifecycle.ts` (L278–434, L548–651: intent lifecycle, discharge, obligation); `store/terminalRows.ts` (L653–778, L1029–1174: projections, inventory, custody notices, writer notes); `store/commandRows.ts` (L780–916, L1259–1496: admission, reads, pages, sweeps, fences); `store/deliveries.ts` (L918–1027, L1197–1257: ending deliveries and command waits); `store/rows.ts` (L1570–1765: decode and projection) | the one class becomes five stores over `StoreDb`: `RequestKeys`, `TerminalIntents`, `TerminalRows`, `CommandRows`, `CommandDeliveries`; `CommandStanding` → `CommandState`; `TerminalStoreFailure` → `ExecutionStoreFailure` |
| `protocol/terminals.ts` | 568 | split (F4 watch, F5 59): `contract/wire/targets.ts` (L67–120), `requestKeys.ts` (L122–207), `terminals.ts` (L209–322, L562–568), `viewLeases.ts` (L324–455), `refusals.ts` (L457–557); the actor part (L27–65: `TerminalActor`, `principalOf`, `actorOfPrincipal`) is already `ActorRef` in platform (W0) | — |
| `protocol/terminalActor.ts` | 16 | `terminals/access.ts`, with `actorOf` (below) — **execution admission**, kept as a domain conversion: an operator or a thread becomes an `ActorRef`, an external session becomes `ActorRef.session`, and a native session standing in no project still refuses `ineligible` (L9–13). v3 dissolved it into `ActorRef`, which names identity and grants nothing | `terminalActorOf` → `executionActorOf` |
| `protocol/commandPolicy.ts` | 162 | split: `contract/wire/commandSubject.ts` (L32–70); `contract/wire/commands.ts` (L10–30, L72–162) | S3 cleared by the renames |
| `protocol/commandReads.ts`, `commandFeed.ts`, `recordStream.ts` | 335 | `contract/wire/commands.ts`, `contract/wire/commandFeed.ts`, `contract/wire/viewLeases.ts` | — |
| `protocol/commandRules.ts` | 277 | `contract/wire/commandRules.ts` | F5 signal |
| `protocol/operations/terminals.ts`, `commands.ts`, `commandRules.ts` | 958 | `contract/wire/operations/terminals.ts`, `commands.ts`, `commandRules.ts` | F4 watch on the first |
| `operations/terminals.ts` | 660 | split (F4 gate): `operations/terminalReads.ts` (L46–411), `operations/terminalActs.ts` (L413–659) | `TerminalActOwners` → `TerminalActNeeds`; `HarnessAdoptionOwner` (external-harnesses) → the terminal-adopter hook; `OperationId` (composition) → platform's brand |
| `operations/commands.ts`, `operations/commandRules.ts` | 525 | `operations/commands.ts`, `operations/commandRules.ts` | `CommandActOwners` → `CommandActNeeds` |
| `projection/commandAnswer.ts`, `commandRuleAnswer.ts`, `terminalAnswer.ts` | 271 | `voice/commands.ts`, `voice/commandRules.ts`, `voice/terminals.ts` | `refusalLines` (graph's `projection/lines.ts`) → platform's voice kit (7.5.7 amended) |
| `terminals/terminalsLayer.ts` | 438 | `executions.ts` (assembly surface) and `host/drivers.ts` (L309–396: the passes of 6) | `TerminalOwners` → `ExecutionServices`, `TerminalFaces` → `ExecutionFaces`, `TerminalFloorUnavailable` → `ExecutionsUnavailable` (S7), `retainTerminalKeys` → `retainRequestKeys`; `WorkingOwners` → the named workspace services |
| `cli/commands/executionHost.ts` | 635 | split (F4 gate): `cli/host/resolve.ts` (L31–259), `cli/host/text.ts` (L261–434), `cli/host.ts` (L435–635) | the recovery road binds no server (claim [[bd6ce719]]) |
| `cli/commands/command.ts`, `cli/commands/terminal.ts` | 131 | `cli/command.ts`, `cli/terminal.ts` | declared in `executions/cli.ts` |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `fixtureHosts.ts` (platform, corrected in §7.6) | finding and ending execution-host processes | `host/processes.ts` |
| `graph/core/orcaProfile.ts` (graph, corrected in §7.6) | the first-run Orca terminal settings import | `terminals/orcaProfile.ts` |
| `protocol/settings.ts` (settings) | the `terminal.*`, `host.memoryShare`, `command.defaultMs` keys | `contract/wire/settings.ts` |
| `protocol/machineStanding.ts` (installation) | the custody literal `'foreign'` → `'other'` (section 5; the file stays installation's, the literal changes in this wave with the CLI's operator output) | — |
| `http/handlers/terminals.ts` (http) | `actorOf` (L33–36): the call's actor turned into an execution actor, refusing typed | `terminals/access.ts` as `executionActor`, beside `executionActorOf`; **both transports switch together** in this wave: the terminal routes' handler (until K2 retires it) and the two socket channels that import it today (`socket/terminalChannel.ts:24`, `socket/commandBytesChannel.ts:6`), which move into this module's feeds (§7.6). Generic HTTP answering (`answered`) stays the transport's |
| `working/releaseAbandonedHolds.ts` (worktrees, corrected in §7.6) | collecting and releasing root uses held by dead terminals and finished commands | `terminals/abandonedHolds.ts` (a pass driven at boot and after disposition) |

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `socket/live.ts` L80–82 and `socket/rpc.ts` L112–126 (socket): the `pace.subscribe` feed, served there directly today → declared and registered in executions's manifest with its name and the shape of `paceStandingSchema` unchanged (the symbol becomes `paceStateSchema` by 7.5.11 (c); the wire does not change), before `socket M2` generates `rpc.ts` (review D1)
- from `socket/terminalChannel.ts`, `socket/commandBytesChannel.ts`, `socket/commandChannel.ts` (socket, §7.6) → `terminals/feeds.ts` (screen, bytes, receipts, grid) and `commands/feed.ts` (the command feed), with their view leases and input lanes, declared in executions' manifest
- from `protocol/pageFamilies.ts` (platform, 7.5.1): `COMMANDS`, `TERMINALS` → `executions/contract/wire/pages.ts`

*(c) Symbols renamed:* `CommandOwner` → `CommandSubject` (and `CommandOwnerKey` → `CommandSubjectKey`, `CommandOwnerSpelling` → `CommandSubjectSpelling`, `ownerKeyOf` → `subjectKeyOf`, `ownerOfKey` → `subjectOfKey`, `principalOfOwner` → `principalOfSubject`; the stored key form `thread:`, `service:`, `operator` unchanged); `ViewerId` → `ViewLeaseId`; host `OperationId` → `HostRequestKey` (type name only); every `*Owner` tag of 8 (a) → its service name; `TerminalsOwner` → `Terminals`; `TerminalOwners` → `ExecutionServices`; `TerminalFloorUnavailable` → `ExecutionsUnavailable`; `HostStanding` → `HostState`; `PreflightStanding` → `PreflightState`; `CommandStanding` → `CommandState`; `TerminalStanding` → `TerminalState`; `GitOwners` → `GitRoads`. Frozen: every table and column except the two request-key tables of 5, the operation names, permission subject strings, the custody wire fields (only the literal changes), boot.json and the state directory layout.

*(d) Leaves:* nothing leaves executions beyond the parts already named elsewhere (`TerminalActor` to platform in W0).

**9. Debt retired.**
- `modules` (consumer `executions`): `executions → cli` (7) by platform's verb contract; `executions → composition` (2) by platform's `OperationId`; `executions → external-harnesses` (1) by the adopter hook; `executions → enforcement` (1: `programRoad.ts`) by the framing split; `executions → worktrees` (1) and `executions → landing` (1) by `rootExecutions` becoming executions' contract; `executions → graph` (5: `project` by projects' key; `refusalLines` by platform's voice kit).
- `names`: F4 gate — `Terminals.ts` (2,649), `TerminalStore.ts` (1,766), `commandWork.ts` (819), `operations/terminals.ts` (660), `executionHost.ts` (635); F1 — `Terminals.ts`, `Worlds.ts`, `command.ts`; F3 — `Terminals.ts`, `Worlds.ts`; F2 — the 19 `terminals/Terminal*`, `terminal*` and `Command*` files listed in the snapshot; S3 — `TerminalsOwner`, `CommandAccessOwner`, `CommandOutputOwner`, `CommandReaderOwner`, `TerminalAccessOwner`, `TerminalGrantsOwner`, `TerminalTargetsOwner`, `CommandOwner` (×3 sites); S7 — `TerminalFloorUnavailable`.

**10. Graph work.**
- The area [[80346cf6]] "Managed executions and the hosts that run them" becomes the zone of `#module` `executions` (`dir` `apps/tagma/server/src/executions`, `depends-on` `projects`, `settings`, `thread-record`, `workspace`, `installation`, `power`), with areas by the concepts of 8: terminals, commands, host, worlds, command rules ([[c243dd9f]]), the grid ([[6f28be31]]), lanes ([[bf60fb40]]), who else typed ([[03c2423c]]).
- [[09d81f01]] "The world a thread's commands run in" moves here from the harness layer (section 1 §1.13's §8.7 row); [[a96e9e89]]'s host backend claims come here from workspace's area.
- Re-anchored at M2: the claims over the five F4 splits (among them [[e8d26502]], [[7262afad]], [[9ecf0ec8]], [[520d9ef8]], [[057fe86e]], [[3054d199]]), each to the part holding its symbol.
- Tasks kept and not broken: [[f28131ab]] (closes into the zone the wave writes), [[ac856604]], [[af5cabcb]], [[7c4a6068]], [[46611756]] (closed by the removal), [[3371f42d]].
- Claims naming `CommandOwner`, `ViewerId`, `'foreign'` custody or the `terminals` module are rewritten at M3.

**11. Acceptance.**
1. `executions/` imports only its needs; zero `modules` and `names` debt; `terminals/` is gone.
2. D7: a server of this wave talks to a host of the previous wire version through the carried codec both ways, and an unsupported capability answers `unsupported`, never a crash (section 2 §2.7).
3. Opening the host environment goes through workspace's backend hook; refused and lost stay distinct.
4. The custody literal reads `'other'` in the app and the CLI in the same build; stored command subject keys read unchanged.
5. A request key taken twice refuses; the retention pass forgets spent keys past the retention and the tally recounts equal.
6. The command feed sends no frame for a command that did not move (the ground of [[ac856604]] is unchanged by the move, and the split does not add a read).

**12. Risks.**
- **The largest split of the plan** (`Terminals.ts`, `TerminalStore.ts`). Both hold one instance's state or one store's statements; the builder moves each part with its private helpers and keeps one instance, one semaphore set, one gate map. The executions integration suites run whole after each part.
- **Hot paths.** `commandFeedReading.ts` and the inventory mirror are under open performance tasks; the wave moves them byte-for-byte and measures the host frame decode share before and after (task [[af5cabcb]]'s measure).
- **The host wire.** D7 must land before any rename touches a wire field; the renames of this wave are type names and one literal, and the codec test compares frames of both versions.
- **Reach into thread identity.** `TerminalThreads`, `commandRules` and `TerminalStore` read `thread` today; after D4 they read `ThreadRecords`. The W2a store step must not change those reads; D4 changes them in its one migration change.

### 7.5.15 `enforcement`

**1. Ownership.** Judging code against the project's rules: inspections, verdicts, debt, triggers, `check_rules`, the record of commits, and what an enforced rule protects against (section 1 §1.3). Directory `enforcement/` (kept). Glossary words owned: **inspection** (builtin or program), **strictness** (`note`, `watch`, `gate`), **trigger**, **debt**, **escape**, **crossing**, **judgement**, **reach** (of a rule: the paths its region's sources cover), **commit queue**.

**2. Wave.** W5, level 8. Opens after projects, settings, workspace, graph, change-record, executions and installation M1 (change-record's prepared change first: section 4 K4); runs beside `performance`, `worktrees`, `sandbox`. Carries **E4**'s judgement certificates and lanes (the landing, merge and reach worker lanes as declared ranks), **K4** (`check_rules` whole in enforcement: `change` over change-record's prepared change, `staged` over workspace's index, `all` over HEAD; retained judgement and full-result verdict unchanged), the enforced-law contract as graph's argument (section 9), the root-published hook contribution, and the commit queue's switch from `TerminalActor` lines to `ActorRef` (reading both formats until the queue drains — W0's note). `landing` opens at its M1.

**3. Offers.**
- `contract/wire/` — `enforcement.ts` (strictness, triggers, `LEGACY_TRIGGERS`, inspections, `Debt`, `Escape`, `LawEnforcement`, `lawEnforcementSchema`, plans and loosenings, read rows, violations — `RuleViolation`, `RuleCrossing`, `Watched`, `CarriedViolation`, `LandingUnjudged` — and answers); `program.ts` (← `protocol/inspectionProgram.ts`: the program contract, input, verdicts, the SARIF subset); `checks.ts` (← `protocol/ruleChecks.ts`: the check subjects and `Checked`); `operations.ts` (`enforce_rule`, `read_inspections`, `check_rules`, `record_commit`).
- `contract/service/` — `ruleChecks.ts` (`RuleChecks`, `ActChecks`, `RuleChecksPort`, `NO_CHECKS`: the before/after judgement every trigger site calls — invocation's admission, landing's publication); `enforcedLaw.ts` (the enforced-law contract: `enforcementOf`, `assertUnenforced`, `Lift` from `graph/work/enforcement.ts`, handed to graph as an argument so graph refuses `rule-enforced` in its own unit); `judge.ts` (`judgingBuilt`, `judgingOver`, `headJudgement`: what landing asks before publication); `remeasures.ts` (`RemeasureDriver`: after-landing triggers, landing calls `landed`).
- **Hooks filled:** workspace's `RootPublished` (install the commit hooks into every published root); graph's enforced-law contract (argument); installation's `DowngradeSteps` — the commit queue's step: `close()` stops admitting commits and `drained()` answers `waiting` and `unread` counts; installation refuses a downgrade unless both are zero (section 5 §5.4.8).
- **Port it uses:** executions' admitted-command capability (`ProgramRoad`), which today's `enforcement/programRoad.ts` declares — it moves to executions (7.5.14) and enforcement keeps the inspection framing.
- **Keys:** `enforcement.programs` (`inspectionPrograms`).
- **Manifest:** its operations, its CLI verb `check`, its passes and worker lanes.

**4. Needs.** `platform` (workers, evidence files, git kit, the trigger shape); `projects` (rule project selection); `settings` (inspection settings); `workspace` (HEAD, index and tree readings; the root-published hook); `graph` (the laws read model, the enforcement document write through `Blocks.setEnforcement`); `change-record` (the session's prepared change, line holders); `executions` (the admitted command run for programs; setup programs of work directories); `installation` (installed hook locations and the CLI runtime baked into hook text). The worktree setup copy (`copyIgnored`) is workspace's.

**5. Tables.** None in the stores: the enforcement document lives in the rule's block (graph's store, written through graph). Durable files it owns: the commit queue file (fsynced admissions), the gate memory JSON beside the machine store, the remembered-checkouts file of the re-measure driver, the warm-tree sidecars. No migration.

**6. Lanes, resources, passes.** Three single-flight worker lanes (landing judge, merge, reach), each with one in-flight ask, an idle stop after 60 s (claim [[dbb7d715]]) and one retry of a dead worker; a warm inspection tree per checkout, leased; work directories for `needs: files` programs; the commit queue drain (one project at a time, backlog-bounded); the re-measure driver (after landings, checks and enforcement writes; its delay and per-rule slots). Every driver is started at layer start (rule [[a00f91b0]]). E4 declares the lanes' ranks and the judgement certificate a landing carries.

**7. Operations.** `enforce_rule`, `read_inspections`, `check_rules`, `record_commit` (names unchanged). Typed routes: none today (the four are operations already). CLI verb: `check` (staged, everything, landed; exit 0/1/2; `TAGMA_ALLOW` stays an external name).

**8. Target file map.**

*(a) Files whose primary owner is `enforcement`* (32 files, 5,610 lines). Paths relative to `enforcement/`.

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `enforcement/judge.ts` | 493 | `judging/judge.ts` | one subject (judging an operation's subject); F4 watch |
| `enforcement/check.ts` | 246 | `judging/check.ts` | `check_rules` over HEAD and over a change |
| `enforcement/staged.ts`, `fileTree.ts` | 121 | `judging/trees.ts` | building judged trees: index, landed commit, edited files over HEAD |
| `enforcement/checks.ts` | 241 | `judging/ruleChecks.ts` | the port's implementation; the trigger index |
| `enforcement/GateMemory.ts` | 64 | `judging/gateMemory.ts` | — |
| `enforcement/reach.ts` | 80 | `rules/reach.ts` | — |
| `enforcement/enforce.ts` | 379 | `rules/enforce.ts` | `EnforceAsk`, `planEnforcement`, `applyEnforcement` keep their names (boundary; the F2-style word is the module's own) |
| `enforcement/measure.ts` | 124 | `rules/measure.ts` | measuring one inspection over its reach |
| `enforcement/reads.ts` | 58 | `rules/reads.ts` | `read_inspections` rows |
| `graph/work/enforcement.ts` | 43 | `contract/service/enforcedLaw.ts` | the contract graph applies, handed as an argument |
| `enforcement/Remeasures.ts` | 296 | `remeasure/driver.ts` | F3 cleared; `Remeasures` stays the service |
| `enforcement/remeasure.ts` | 493 | `remeasure/rule.ts` | F4 watch |
| `enforcement/Inspections.ts`, `asks.ts`, `inspecting.ts`, `landing.worker.ts`, `reach.worker.ts` | 434 | `workers/lanes.ts`, `workers/asks.ts`, `workers/inspecting.ts`, `workers/judge.worker.ts`, `workers/reach.worker.ts` | `landing.worker.ts` → `judge.worker.ts` (it answers judge asks for landings, checks and edits); the worker entry paths are data in the lane spawner and change with it |
| `enforcement/WarmTrees.ts`, `workdirs.ts` | 460 | `workers/warmTrees.ts`, `workers/workdirs.ts` | — |
| `enforcement/programs.ts` | 251 | `programs/run.ts` | — |
| `enforcement/programRoad.ts` | 23 | → executions (7.5.14, `commands/programRoad.ts` contract) | the port's type becomes executions' admitted-command capability; `programs/run.ts` calls it |
| `enforcement/programFixture.ts` | 23 | `programs/fixture.ts` | test double of this module |
| `enforcement/CommitQueue.ts` | 175 | `commits/queue.ts` | reads `TerminalActor` lines and `ActorRef` lines until drained, writes `ActorRef` |
| `enforcement/commitHooks.ts` | 204 | `commits/hooks.ts` | installed through workspace's `RootPublished` hook, and by the hook sweep on retry |
| `operations/enforcement.ts` | 276 | `operations.ts` | `changeSubject` (landing's `submitWork.ts`) → change-record's `PreparedChanges` |
| `projection/enforcementAnswer.ts` | 124 | `voice.ts` | — |
| `protocol/enforcement.ts` | 273 | `contract/wire/enforcement.ts` | F5 signal |
| `protocol/inspectionProgram.ts` | 151 | `contract/wire/program.ts` | — |
| `protocol/ruleChecks.ts` | 154 | split: subjects and `Checked` (L16–115) → `contract/wire/checks.ts`; the port (L118–154) → `contract/service/ruleChecks.ts` | `holderOf` reads platform's `ActorRef` |
| `protocol/operations/enforcement.ts` | 237 | `contract/wire/operations.ts` | `checkSubjectOf`, `OperationId` (composition) → platform's brand and an argument |
| `cli/commands/check.ts` | 155 | `cli/check.ts`, declared in `enforcement/cli.ts` | platform's verb contract |

*(b) Parts received:* `check_rules` as a whole (section 4 K4: today split between `operations/enforcement.ts` and the landing's change subject); the enforcement violation types used by graph's `projection/lines.ts` go to landing's voice with `submitLines` (7.5.7). 

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `protocol/pageFamilies.ts` (platform, 7.5.1): `INSPECTIONS`, `VIOLATIONS` (with `PROGRAM_MESSAGE_CHARS`) → `enforcement/contract/wire/pages.ts`

*(c) Symbols renamed:* `landing.worker.ts` → `judge.worker.ts` (file only). Frozen: the enforcement document's shape and legacy trigger decode, refusal codes (`rule-violated`, `inspection-failed`, `rule-enforced`, `rule-escaped`), SARIF fields, `TAGMA_ALLOW`, the hook script names. *(d) Leaves:* `programRoad.ts`' port type → executions.

**9. Debt retired.** `modules`: `enforcement → cli` (3) by platform's verb contract; `enforcement → composition` (2) by platform's `OperationId` and an argument; `enforcement → landing` (1) by the prepared change. Edges into it cut elsewhere: `graph → enforcement` (10, 7.5.7), `executions → enforcement` (1, 7.5.14). `names`: `Remeasures.ts` F3; F4 and F5 entries are watch signals.

**10. Graph work.** The area [[805446cf]] "Rule enforcement" becomes the zone of `#module` `enforcement` (`dir` `apps/tagma/server/src/enforcement`, `depends-on` `projects`, `settings`, `workspace`, `graph`, `change-record`, `executions`, `installation`), with areas: judging, rules and reach, re-measure, workers, programs, commits. [[c63391c1]] re-hangs under re-measure; [[53a4338a]] (the lifting guard) re-anchors to `contract/service/enforcedLaw.ts` and names graph as the applier. [[1023b406]] (floors rank `src`) is rewritten when the floor rule's emptied entries go (§7.2.6). Rules in this area at watch or gate stay: the area becomes the module, it does not dissolve.

**11. Acceptance.**
1. `enforcement/` imports only its needs; zero `modules` debt.
2. `check_rules --over change` and `submit_work` judge the same prepared change and answer the same verdict; `--over staged` answers what a commit of the index would meet (claim [[b5b8cb27]]).
3. A root published by `create_worktree` carries the commit hooks before the act answers; a failure is named and retried by the hook sweep, never rolling back the publication.
4. The commit queue drains lines written before the wave (`TerminalActor`) and after it (`ActorRef`) alike; its downgrade step, once closed, admits nothing and reports `waiting` and `unread` exactly (a test appends an unread line and sees the downgrade refused).
5. Moving or switching off a rule at watch or gate refuses `rule-enforced` from graph's unit, through the argument.

**12. Risks.**
- **Worker entry paths are data.** The lane spawner names `landing.worker.ts` and `reach.worker.ts` by path; the rename lands in the same change as the spawner, and the inspection suite spawns both.
- **`check_rules` crosses the prepared change.** If change-record's M1 is late, `check_rules --over change` keeps today's `changeSubject` import until it lands; the debt entry stays owned by this wave, and the import is the one allowed exception, named in the wave report.
- **Hook installation moves from worktree creation to root publication.** A root published by any other road now gets hooks too; the builder lists today's publication roads (worktree creation, adoption, restore) and tests each.

### 7.5.16 `performance`

**1. Ownership.** The server's record of its own running and the reports read from it (section 1 §1.3). Directory `performance/` (kept). Glossary words owned: **performance reading**, **capture** (a CPU profile or a memory reading), **handed artifact** (a capture delivered into the caller's scratch). The recording store and its spans are the `@runlith/performance` package's.

**2. Wave.** W5, level 8. Opens after executions M1 (the host reading); runs beside `enforcement`, `worktrees`, `sandbox`. Carries K2 for the performance routes and the move of `vacuum_database`'s declaration out of its operation file to installation (7.5.9), and the telemetry keys from `protocol/settings.ts` (`tracesMaxBytes`, `performanceStorageLimit`, `performancePendingLimit`, `performanceSpanMinMicros` ← `performanceSpanFloorMicros`, `performanceKeepOneTraceIn`, `vitalsIntervalMs`, `metricsIntervalMs`; settings card).

**3. Offers.** `contract/wire/performance.ts` (read and capture values, `PerformanceValue`, `HandedArtifact`); `contract/wire/operations.ts` (`capture_performance_profile`, `capture_memory_reading`, `read_performance`, `read_host_performance`); `contract/wire/settings.ts` (the telemetry keys); `voice.ts` (`performanceText`, which native-harness' tool answers render). No service beyond the operation bodies; metric recording is platform's and the package's.

**4. Needs.** `platform` (metric records, ledger readings, `Caller`); `executions` (the host's performance ring, and a thread's world files to hand a capture into its scratch).

**5. Tables.** None: the performance package keeps its own store files. **6. Lanes, resources, passes.** None of its own; the capture is bounded by the inspector's own budget. From accepted [[9c085c6c]] §3.13.10: performance owns the phase ledger's storage and completeness, the suite and D9's loop attribution by owner and kind. E0 records the G1–G6 baselines at today's code; E5's inline bounds start unestablished, and D9 measures them before any fixed worker count or threshold is asserted. **7. Operations.** The four above (names unchanged). Routes (K2): the three of `api/performance.ts` → `read_performance`, `capture_performance_profile`, `capture_memory_reading`.

**8. Target file map** (6 files, 564 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `operations/process.ts` | 89 | `performance/operations.ts` | `TerminalOwners` → executions' `ExecutionServices`; `WorldFiles` from executions' worlds contract |
| `projection/performance.ts` | 188 | `performance/voice.ts` | — |
| `projection/performanceRead.ts` | 69 | `performance/reads.ts` | the failure-to-answer adapters |
| `protocol/operations/process.ts` | 102 | `performance/contract/wire/operations.ts` | `vacuum_database` (L82–99) → installation; `PROCESS_OPERATIONS`, `ProcessOperationId`, `PROCESS_OPERATION_IDS` → `PERFORMANCE_OPERATIONS`, `PerformanceOperationId`, `PERFORMANCE_OPERATION_IDS` (the file no longer holds a process operation) |
| `protocol/performance.ts` | 85 | `performance/contract/wire/performance.ts` | — |
| `api/performance.ts` (http's group, listed here for its routes) | 25 | retires through K2; http's card lists the file (7.5.24) | — |

*(b) Parts received:* the telemetry keys. *(c) Symbols renamed:* `PROCESS_*` → `PERFORMANCE_*` as above. *(d) Leaves:* `vacuum_database`'s declaration → installation.

**9. Debt retired.** `modules`: none with `performance` as consumer (its imports of executions and platform are relations). `names`: none.

**10. Graph work.** The claims of the performance reads hang today under the operation layer areas ([[3dbd3b23]], [[70b217f6]]); the wave writes the zone of `#module` `performance` (`dir` `apps/tagma/server/src/performance`, `depends-on` `executions`) and re-hangs them. The `performance` skill's contract is not this module's.

**11. Acceptance.** `performance/` imports only platform and executions; the four operations answer as today; a capture lands as a `.cpuprofile` in the caller's scratch.

**12. Risks.** None beyond the rename of the operation-id constants, which `threads`' doctrine and native-harness' capability list read; they change in the same change.

### 7.5.17 `worktrees`

**1. Ownership.** Tagma-managed worktrees: preparing, creating and setting them up, their branches and names, and retiring them — archive, restore, forget, delete — with the threads placed in them answered by `threads` and their leftover work committed by `landing` (section 1 §1.3, narrowed from v7). Directory `worktrees/` (kept). Glossary words owned: **worktree** (a Tagma-managed checkout record), **creation intent**, **archive intent**, **setup** (copy and command), **provisional branch**, **hue**, **cleanup**.

**2. Wave.** W5, level 8. Opens after projects, settings, thread-record, workspace, graph, change-record and executions M1; runs beside `enforcement`, `performance`, `sandbox`. Carries **E4**'s archive intent (one row per archive call, written before any effect, each phase recorded before its effect — section 1 §1.13), the `PreservationCommit` port and the retirement-settlement and placed-threads hooks it declares, the rename `worktree_operation` → `worktree_intent` (section 5 §5.4.6), and K2 for the worktree routes. `landing` opens at its M1 (it implements `PreservationCommit` and reads the worktree record and finishing gate).

**3. Offers.**
- `contract/wire/` — `creation.ts` (the request key is platform's `RequestKey`, which section 5 §5.4.3 merges from `WorktreeOperationId` and `ThreadTargetOperationKey` — no worktree-local brand; `WorktreeRevision`, `WorktreeMode`, branch naming, `WorktreeRequest` ← `WorktreeIntent` (the request fields), `WorktreeIntent` ← `WorktreeOperation` (the stored `worktree_intent` row), status and evidence, preparation, recovery and their field sets); `rows.ts` (hues, setup, kinds, `WorktreeState`, `MergeCheck`, `WorktreeAgents`, `WorktreeRow`, `WorktreeListing`, running acts and feed events); `failures.ts` (`WorktreeRefused`, `WorktreeMissing`, `WorktreeUnavailable`, `WorktreeFailure`, `FinishReason`, `FINISH_REASONS`); `retirement.ts` (the lifecycle arms of `protocol/worktreeFinishing.ts`: `WorktreeArchived`, `BranchCommit`, `WorktreeDeleted`, `WorktreeRestored`, `WorktreeForgotten`, `ArchivedWorktree(s)`, `ThreadKept`, `WorktreeThreads`); `cleanup.ts`; `entries.ts` (created, setup and moved journal entries threads turn into notes); `renames.ts`; `subjects.ts`; `operations/*.ts`.
- `contract/service/` — `worktrees.ts` (`WorktreeRecords`: the record by root, the finishing gate landing and threads read), `creation.ts` (`WorktreeCreation` ← `Worktrees`, `WorktreeActs` ← `WorktreeOwner`), `listing.ts` (`WorktreeListing` ← `WorktreeListingOwner`), `renames.ts` (`WorktreeRenames` ← `WorktreeRenamesOwner`), `retirement.ts` (archive, restore, forget, delete; `WorktreeCleanup` ← `WorktreeCleanupOwner`).
- **Port declared:** **`PreservationCommit`** ← implemented by `landing` (commit a retiring worktree's leftover work under landing's intent, witness and receipt, keyed by the archive intent; section 1 §1.4.3). **Bound at `worktrees M1` to the real keyed publication**, which the task `landing preservation` raises before this wave (§7.2.2, §7.2.7; review C2): the archive commits only through it, never through a direct `stageAt`/`commitAt`.
- **Hooks declared (start-bound):** **retirement settlement** ← landing (drops `worktree_pending_merge` inside the archive unit, C2b); **placed threads** ← threads (put away or kept per placed thread, each in its own unit, answering moved or kept).
- **Events:** `worktreeRecorded`, `worktreeMoved`, `setupSettled`, `branchRenamed` (today's listener sets `told`) → threads (notes), socket.
- **Keys:** `worktreeFolder`, `worktreeBranchPrefix`, `worktreeSetupCopy`, `worktreeSetupRun`.

**4. Needs.** `platform` (git kit, units, durable intents); `projects` (key-ref); `settings` (setup command, copied files, naming); `thread-record` (`titleRecorded` for provisional branches, carrier identity); `workspace` (participant: root, repository and project-root publication in one unit; `copyIgnored`; `EnvironmentAccess`; `CheckoutRows` for listing); `graph` (preserve an ended checkout's graph history; `followBranch` for a served tree's twin); `change-record` (held lines standing in a root, for cleanup blockers); `executions` (setup programs as admitted commands; `rootExecutions` to end what runs on archive — decision [[4f4df24b]]).

**5. Tables** (machine store): `worktree`; **`worktree_intent`** ← `worktree_operation` (M3 migration, copy-drop-rename, section 2 §2.10 rollback); **`worktree_archive_intent`** (new, E4). `worktree_pending_merge` is landing's (its store moves there; this module drops rows only through landing's retirement-settlement hook). `project_root` rows are written through workspace as a participant.

**6. Lanes, resources, passes.** Per-root worktree turns serialized by the progress tracker; per-path finishing gates; the setup flights; the merge-check caches (512 entries each) and the listing's head-time cache (64); the feed's per-subscription state. Passes (rule [[a00f91b0]]): setup resume at boot for unsettled records, the archive intent driver at boot (each phase re-asked by its key, never redone on the strength of a phase name), the unborn-worktree release for a birth that failed. The retry watcher of the merge queue is landing's.

**7. Operations.** `create_worktree`, `prepare_worktree`, `adopt_worktree`, `abandon_worktree`, `reconcile_worktree`, `read_worktree_operation`, `prepare_worktree_recovery`, `list_worktrees`, `archive_worktree`, `restore_worktree`, `forget_worktree`, `delete_worktree`, `rename_worktree`, `clean_up_worktrees`, `list_archived_worktrees`, `list_worktree_cleanup` (names unchanged; `read_worktree_operation` is a catalog name and stays). Leave: `check_worktree_merge`, `merge_worktree`, `cancel_worktree_merge`, `open_worktree_pr` → landing; `update_worktree` → threads; `read_repositories` → workspace. Routes (K2): `api/worktrees.ts`' 22 routes map one to one onto these and landing's operations; `stores` → `read_repositories` (workspace).

**8. Target file map.**

*(a) Files whose primary owner is `worktrees`* (25 files, 6,015 lines). Paths relative to `worktrees/`.

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `db/worktrees.ts` | 78 | `store/tables.ts` (`worktree`, `worktree_intent`, `worktree_archive_intent`); `worktree_pending_merge` (L62–78) → `landing/store/tables.ts` | — |
| `working/WorktreeStore.ts` | 377 | `store/worktrees.ts` | `project_root` writes go through workspace's participant; `WorktreeStoreFailure` kept |
| `working/Worktrees.ts` | 815 | split (F3, F4 gate): `creation/requests.ts` (L28–105); `creation/execute.ts` (L124–249: prepare, execute); `creation/recovery.ts` (L251–402: read, recovery preparation, adopt, abandon, interrupted runs, reconcile); `creation/publication.ts` (L404–632: root publication, drafts, guards, reservation, registration, observation, settle); `creation/checks.ts` (L633–812: ref, path, witness and admission checks, failure mapping) | `Worktrees` → `WorktreeCreation` |
| `worktrees/WorktreeActs.ts` | 208 | `creation/acts.ts` | `WorktreeOwner` → tag `WorktreeActs` |
| `worktrees/WorktreeSetups.ts` | 188 | `setup/drive.ts` | — |
| `terminals/setupCommands.ts` | 69 | `setup/commands.ts` | `terminalSetupCommands` → `setupCommands`; admitted through executions |
| `working/programRun.ts` | 34 | `setup/programRun.ts` | `ProgramEnded` (from landing's `WorktreeFinishing.ts`) moves here |
| `working/ProvisionalBranches.ts` | 149 | `branches/provisional.ts` | thread placement read through the placed-threads hook |
| `working/WorktreeRenames.ts` | 354 | `branches/rename.ts` | `WorktreeRenamesOwner` → tag `WorktreeRenames`; `WorktreeFinishRefused`, `FinishFailure` → this module's `failures.ts` |
| `working/MergeChecks.ts` | 51 | `listing/mergeChecks.ts` | a reading of the worktree against its base |
| `working/WorktreeProgress.ts` | 146 | `progress.ts` | — |
| `worktrees/WorktreeFeed.ts` | 689 | split (F2, F4 gate): `listing/feed.ts` (L34–355: contract, helpers, run loop, act frames, open and incremental passes); `listing/membership.ts` (L357–688: archive mark, membership, build, tips, measures, checkout holds, placings, publish) | — |
| `worktrees/WorktreeListing.ts` | 298 | `listing/reads.ts` | `WorktreeListingOwner` → tag `WorktreeListing` |
| `worktrees/worktreeRows.ts` | 255 | `listing/rows.ts` | — |
| `worktrees/WorktreeCleanup.ts` | 188 | `retirement/cleanup.ts` | `WorktreeCleanupOwner` → tag `WorktreeCleanup` |
| `working/UnbornWorktrees.ts` | 50 | `retirement/unborn.ts` | — |
| `worktrees/worktreeRefusal.ts`, `working/worktreeFailureCodes.ts` | 255 | `refusals.ts` | `admittedWorktreeRefusal`'s checkout part is workspace's own now (7.5.6) |
| `working/releaseAbandonedHolds.ts` | 129 | → **`executions`** `terminals/abandonedHolds.ts` (territory correction, §7.6) | it joins root uses against terminal, request-key, command and wait rows — executions' tables |
| `protocol/worktrees.ts` | 404 | split (F4 watch, F5 52): `contract/wire/creation.ts` (L9–211), `rows.ts` (L212–360), `failures.ts` (L362–404); `PendingMerge`, `MergeMode`, `MergeAfter` → landing; `EndedExecution` → executions | — |
| `protocol/worktreeCleanup.ts`, `worktreeEntries.ts` | 115 | `contract/wire/cleanup.ts`, `contract/wire/entries.ts` | the `merged` entry arm → landing's merge receipt (threads reads it) |
| `protocol/worktreeSubjects.ts` | 93 | `contract/wire/subjects.ts` | `resolutionSubjects`, `checkoutActSubjects` → workspace |
| `protocol/operations/working.ts` | 306 | `contract/wire/operations/creation.ts` | `read_repositories` → workspace; `WORKING_OPERATIONS`, `WorkingOperationId`, `WORKING_OPERATION_IDS` → `CREATION_OPERATIONS`, `CreationOperationId`, `CREATION_OPERATION_IDS` |
| `operations/worktrees.ts` | 739 | split by operation owner (F4 gate): `operations/creation.ts` (L43–117 helpers, L135–295); `operations/retirement.ts` (rename, archive, delete, forget, restore: L561–629); `operations/listing.ts` (L651–739); `read_repositories` and the checkout bodies (L119–134, L296–490) → workspace; merge and pull-request bodies (L492–560) → landing; `update_worktree` (L630–650) → threads | `CommitHooks` (enforcement) removed: hooks arrive through workspace's `RootPublished`; `RuleChecksPort` for checkout commits and pulls goes with the checkout bodies to workspace, which calls enforcement's port through invocation's trigger; `OPERATIONS`, `OperationId` (composition) → platform's brand |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `working/WorktreeFinishing.ts` (landing) | archive (L552–613 part), forget, restore, delete (L615–732), the archived listing and interrupted-archive recovery (L828–872 part), the record and ending guards they use (L874–1113 part), `FinishingThreads`, `PlacedThread`, `StandingThread` → `LiveThread` (section 5: eligibility → **live**) | `retirement/archive.ts`, `retirement/restore.ts`, `retirement/forget.ts`, `retirement/delete.ts`, `retirement/guards.ts` — driven by the archive intent; the leftover commit through `PreservationCommit`; threads through the placed-threads hook |
| `protocol/operations/finishing.ts` (landing) | archive, restore, forget, delete, rename, clean-up and list declarations (L143–358 part) | `contract/wire/operations/retirement.ts` |
| `protocol/worktreeFinishing.ts` (landing) | the lifecycle arms (L56–104, L136–181 part), `FINISH_REASONS`, `FinishReason` | `contract/wire/retirement.ts`, `failures.ts` |
| `protocol/settings.ts` (settings) | the four `worktree*` keys | `contract/wire/settings.ts` |

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `socket/worktreeChannel.ts` (socket, §7.6) → `listing/feed.ts`, declared in worktrees' manifest
- from `protocol/pageFamilies.ts` (platform, 7.5.1): `WORKTREES`, `ARCHIVED_WORKTREES`, `WORKTREE_CLEANUP` → `worktrees/contract/wire/pages.ts`

*(c) Symbols renamed:* `WorktreeOperationId` → platform's `RequestKey` (section 5 §5.4.3; the field `operationId` → `requestKey` through `renamed: {from: 'operationId'}` for one release, K5a); `WorktreeIntent` → `WorktreeRequest` and then `WorktreeOperation` → `WorktreeIntent`, in that order in one change, so no site reads the wrong type (the record takes its table's word, section 5 §5.4.6); `Worktrees` → `WorktreeCreation`; `WorktreeOwner` → `WorktreeActs`; `WorktreeListingOwner`, `WorktreeRenamesOwner`, `WorktreeCleanupOwner` → their service names; `StandingThread` → `LiveThread`; `WORKING_*` → `CREATION_*`; `terminalSetupCommands` → `setupCommands`. Frozen: `worktree`'s columns, refusal codes, operation names, the hue list, branch naming spellings.

*(d) Leaves:* `releaseAbandonedHolds.ts` → executions; `worktree_pending_merge` and the merge types → landing; `update_worktree` → threads; the checkout and repository reads → workspace.

**9. Debt retired.** `modules`: `worktrees → landing` (13: `worktrees.ts`, `programRun.ts`, `UnbornWorktrees.ts`, `WorktreeRenames.ts` +2) by the `WorktreeFinishing` split, `PreservationCommit`, the retirement-settlement hook and the lifecycle failure types moving here; `worktrees → composition` (1) by platform's brand; `worktrees → enforcement` (2 imports in `operations/worktrees.ts`) by `RootPublished` and the checkout bodies leaving. `names`: `Worktrees.ts` F3, F4 gate (815); `operations/worktrees.ts` F4 gate (739); `WorktreeFeed.ts` F2, F4 gate (689); `WorktreeActs.ts`, `WorktreeCleanup.ts`, `WorktreeListing.ts`, `WorktreeSetups.ts`, `worktreeRefusal.ts`, `worktreeRows.ts` F2; S3 `WorktreeOwner`, `WorktreeRenamesOwner`, `WorktreeCleanupOwner`, `WorktreeListingOwner`.

**10. Graph work.** The areas [[f690ada2]] "What a worktree is to the product", [[0fe81f69]] "Making a checkout" and the lifecycle half of [[af4f0ba5]] "Finishing a worktree" become the zone of `#module` `worktrees` (`dir` `apps/tagma/server/src/worktrees`, `depends-on` `projects`, `settings`, `thread-record`, `workspace`, `graph`, `change-record`, `executions`); the merge, pull-request and queue half of [[af4f0ba5]] goes to landing; [[9c02d7f7]] "The public road onto checkouts" splits between workspace (reads, acts) and this zone (creation); [[579437df]] (a worktree's branch name) comes here. Decisions [[8e396041]] and [[4f4df24b]] stay related; [[45c0b92d]] (finishing through merge check, merge or PR, and archive that commits leftovers) is re-read against the split and relates to both zones. The worktree claims under [[6442078a]] re-hang here (7.5.6).

**11. Acceptance.**
1. `worktrees/` imports only its needs; zero `modules` and `names` debt.
2. Archiving a worktree with leftover work commits it through `PreservationCommit` under the archive intent's key; a restart mid-archive asks landing by that key whether the commit exists and never commits twice.
3. Archiving drops the worktree's pending merge in the archive unit through landing's hook; with the hook unbound, archive refuses.
4. The threads placed in an archived worktree are each answered moved or kept by threads, each in its own unit.
5. Every root a creation publishes carries enforcement's commit hooks before `create_worktree` answers (through workspace).
6. `worktree_intent` holds every standing creation intent after the migration; `read_worktree_operation` reads it back as before.

**12. Risks.**
- **`WorktreeFinishing.ts` is split between two waves.** Landing is its primary owner (W5, level 9) and this wave takes the lifecycle parts first (§7.4.4): the retirement scenarios move here at M2, leaving merge, pull request and the queue at the old path until landing's wave. Both waves' builders read the same part list (8 (b) here, 8 (a) there).
- **The archive intent is a new durable driver.** Its boot driver lands with it (rule [[a00f91b0]]); the kill-mid-phase test runs for each phase.
- **The feed is hot** (every checkout move re-derives rows). The split keeps one subscription state per subscriber and moves the code byte-for-byte; no new read is added.

### 7.5.18 `landing`

**1. Ownership.** Publishing work into a project's git on a thread's or the operator's behalf: landing a session's change, preserving a retiring worktree's leftover work, merging a worktree into its base, pull requests, the merge queue, and the receipts of each; the graph's commits of its own acts stay the graph's (section 1 §1.3, module `delivery` renamed **`landing`** by section 5). Directory `landing/`. Glossary words owned: **landing** (publishing a session's change), **merge**, **merge queue**, **merge receipt**, **preservation commit**, **pull request**.

**2. Wave.** W5, level 9. Opens after projects, settings, thread-record, workspace, graph, change-record, enforcement and worktrees M1; runs alone. Carries **E4**'s landing protocol (section 3 §3.4.2: landing intents, witnesses and receipts, the commit and hook lanes, commit-tree/update-ref compare-and-swap, tails, the merge claim), `merge_receipt`, the remaining publication code after the early `landing preservation` task, the retirement-settlement hook contribution, and K2 for the landing routes. `MergeNotice` is declared and bound jointly with threads at `threads M1`, not here (§7.2.7). `threads` opens at its M1.

**3. Offers.**
- `contract/wire/` — `receipt.ts` (← `protocol/submitReceipt.ts`: the landed commit, carried lines, refusal, watched, carried violations, unjudged); `merge.ts` (`MergeReading`, `GraphMerge`, `GraphSync`, `AfterMerged`, `WorktreeMerged`, `WorktreeMergeQueued`, `WorktreeMergeAnswer`, `WorktreeMergeCancelled`, `WorktreePullRequest`, `PendingMerge`, `MergeMode`, `MergeAfter`, `MergedAfter`, `MERGE_TRAILER`, the merge receipt and the `merged` entry arm threads reads); `operations.ts` (`submit_work`, `check_worktree_merge`, `merge_worktree`, `cancel_worktree_merge`, `open_worktree_pr`).
- `contract/service/` — `landings.ts` (`Landings`: land a prepared change; the per-root landing gate); `merges.ts` (`Merges` ← `WorktreeFinishingOwner`'s merge half, `PendingMerges` ← `PendingMergesOwner`); `receipts.ts` (merge receipts by worktree, read by threads for notes).
- **Implements:** worktrees' `PreservationCommit` (the leftover commit under landing's own intent, witness and receipt, keyed by the archive intent) — built **early**, by the task `landing preservation` before `worktrees M1` (the `landing/` directory with `contract/service/preservation.ts`, `land/preservation.ts` and the preservation intent and receipt rows in `store/`), so worktrees binds the real keyed publication from its first merge (review C2); `landing M1` moves nothing of it again; **fills** worktrees' retirement-settlement hook (drops `worktree_pending_merge` in the archive unit).
- **Port declared:** **`MergeNotice`** ← implemented by threads (the merged note written in the merge's unit, section 1 §1.13 "Merge" row). **The declaration, threads' implementation and landing's switch to it land in one joint step at `threads M1`** (review C3): until then the old path — the post-merge `WORKTREE_ENTRY` note of `working/WorktreeFinishing.ts` L421–460 and `harness/WorktreeNotes.ts` L73–118 — stays exactly as it is, and `landing M1` declares no `MergeNotice`.
- **Events:** `mergeSettled(rootId)` → threads, worktrees' listing; `landed(sessionId, commit)` → enforcement's re-measure driver (it asks after landing), change-record's stamp.
- **Keys:** landing and merge preferences (today unnamed in `protocol/settings.ts`; if a key exists it moves with this card, else none).

**4. Needs.** `platform` (the hook lane, commit lane, commit-tree/update-ref CAS, durable landing witness); `projects` (key-ref); `settings` (landing and merge preferences); `thread-record` (carrier identity, lineage); `workspace` (checkout place, index settle, checkout acts); `graph` (the tasks a session holds, named in the commit subject); `change-record` (the prepared change; the stamp after landing); `enforcement` (judge the built tree before publication; after-landing triggers); `worktrees` (the worktree record and finishing gate; `PreservationCommit`; the retirement-settlement hook).

**5. Tables** (machine store): `worktree_pending_merge` (moved from `db/worktrees.ts`, name kept); **`merge_receipt`** (new: commit, mode, base, waited-since, after-act outcome, addressees — section 1 §1.13); **`landing_intent`** (new, E4: one row per landing or preservation call, its phase and receipt key). `landing preservation` creates the `landing_intent` row contract and its storage before `worktrees M1`; `landing M1` reuses it and creates `merge_receipt`. The queue table keeps its rows.

**6. Lanes, resources, passes.** The per-root landing gate (today the module-level `gates` semaphores of `submitWork.ts`) becomes a declared rank under the commit lane; the per-root merge gates and base watchers of the queue; the retry tick. Passes (rule [[a00f91b0]]): the queue's resume at boot and its retry tick; the landing intent driver at boot (asks by key whether a commit exists, never commits twice); interrupted-merge recovery at boot (today `recover`, `interrupted`). Task [[ef42cd77]] (landing fences no runs: `holdLanding` has no landing caller) is this wave's to close: the landing gate admits runs through thread-record's phase, and the fence gets its caller.

**7. Operations.** `submit_work`, `check_worktree_merge`, `merge_worktree`, `cancel_worktree_merge`, `open_worktree_pr` (names unchanged). Routes (K2): `POST /api/changes/submit` → `submit_work`; `GET`, `POST`, `DELETE /api/worktree-roots/:rootId/merge` → `check_worktree_merge`, `merge_worktree`, `cancel_worktree_merge`; `POST …/pull-request` → `open_worktree_pr`.

**8. Target file map.**

*(a) Files whose primary owner is `landing`* (10 files, 3,601 lines). Paths relative to `landing/`.

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `harness/submitWork.ts` | 747 | split (F4 gate) by section 1's line: **to change-record** — `changeSubject`, `ChangeInput` (L290–336), carrier selection `carriersOf` (L111–149 part), the tree build and own-line planning `build`, `mirrored`, `ownBlobs`, `heldOf`, `planPath` (L524–697), the subject reads `holdersOf`, `callerOf`, `subjectOf`, `emptyTree` (L338–437 part) → `change-record/prepared/*` (the prepared change, 7.5.10); **to landing** — `land/gate.ts` (L27–73: the per-root gate, git failure words), `land/message.ts` (L75–109: subject and message with the held tasks), `land/submit.ts` (L154–288: `submitWork`, held landing), `land/commit.ts` (L438–522: the mid-operation guard, the retrying commit, `headOf`, `tipOf`), `land/indexSync.ts` (L699–747) | `ThreadRowMark` (threads) → change-record's `heldChanged` |
| `working/WorktreeFinishing.ts` | 1,124 | split (F4 gate): **landing keeps** `merge/check.ts` and `merge/merge.ts` (L304–476: merge check, merge, judged, after-merge, land), `merge/pullRequest.ts` (L744–783: `openPullRequest`), `merge/recovery.ts` (the interrupted-merge part of L828–872), `merge/failures.ts` (L70–166 and L182–240, merge part); **to worktrees** — archive, forget, restore, delete, the archived listing and their guards (7.5.17 (b)); **to threads** — `updateFromBase` (L784–826) and the placed-thread handling | `WorktreeFinishingOwner` → tag `Merges`; `StandingExecution`, `RootEnding` → executions' contract (7.5.14); `ProgramEnded` → worktrees |
| `working/PendingMerges.ts` | 244 | `queue/pendingMerges.ts` | `PendingMergesOwner` → tag `PendingMerges` |
| `working/PendingMergeStore.ts` | 103 | `store/pendingMerges.ts` | — |
| `protocol/operations/finishing.ts` | 362 | split: `contract/wire/operations.ts` (L68–197 merge and pull request part, with `submit_work` from graph); the lifecycle declarations → worktrees | `FINISHING_*` → `LANDING_OPERATIONS`, `LandingOperationId`, `LANDING_OPERATION_IDS`; `FinishingPlace` → `LandingPlace` |
| `protocol/worktreeFinishing.ts` | 219 | split: `contract/wire/merge.ts` (merge readings and answers, pull request); `GraphKindChanges`, `GraphChanges` → graph's own contract (7.5.7); the lifecycle arms and finish reasons → worktrees | F5 ends |
| `protocol/submitReceipt.ts` | 41 | `contract/wire/receipt.ts` | — |
| `harness/checkoutFixture.ts`, `harness/landingFixture.ts`, `worktrees/finishingFixture.ts` | 751 | composition's test world | each assembles store, change-record, graph, enforcement, workspace and worktrees (section 6) |

*(b) Parts received:*

| From (primary owner) | Part | Target |
|---|---|---|
| `protocol/operations/graph.ts`, `operations/projects.ts` (graph) | `submit_work`'s declaration (L1641–1711 part) and body (L121–186 part) | `contract/wire/operations.ts`, `operations/submit.ts` |
| `projection/lines.ts` (graph) | `submitLines`, `judgedLines` (L78–128) | `voice.ts` |
| `operations/worktrees.ts` (worktrees) | the merge and pull-request bodies (L492–560) | `operations/merge.ts` |
| `protocol/worktrees.ts` (worktrees) | `PendingMerge`, `MergeMode`, `MergeAfter` | `contract/wire/merge.ts` |
| `protocol/worktreeEntries.ts` (worktrees) | the `merged` entry arm | `contract/wire/merge.ts`, as the merge receipt threads reads |
| `db/worktrees.ts` (worktrees) | `worktree_pending_merge` (L62–78) | `store/tables.ts` |
| `harness/WorkspaceChangeLog.ts` (change-record) | the task labels a landing names (its `TagTable` read) | `land/message.ts`, through graph's `tasksHeld` service |
| new | preservation landing, landing intents, merge receipts | `preservation/commit.ts`, `store/intentLifecycle.ts`, `store/receipts.ts` |

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `doctrine/sections/` (threads, 7.5.20): `gitAndGithub.ts` → `landing/doctrine/<same stem>.ts`, contributed through the doctrine hook (ids unchanged)

*(c) Symbols renamed:* `WorktreeFinishingOwner` → `Merges`; `PendingMergesOwner` → `PendingMerges`; `FINISHING_*` → `LANDING_*`; `FinishingPlace` → `LandingPlace`. Frozen: `worktree_pending_merge`'s columns, `MERGE_TRAILER`'s text (it is written into commits), refusal codes, operation names.

*(d) Leaves:* the prepared change's parts → change-record; the lifecycle parts → worktrees; `updateFromBase` → threads; `GraphChanges` → graph; the three fixtures → composition.

**9. Debt retired.** `modules` (consumer `landing`; the registry and territory scripts of section 1 still spell the module `delivery`, and the debt keys are written `landing` from P4 on): `landing → threads` (1: `submitWork.ts`) by `heldChanged`. Edges into it cut by other cards: `worktrees → landing` (13), `graph → landing` (4), `enforcement → landing` (1), `executions → landing` (1). `names`: `submitWork.ts` F4 gate (747), `WorktreeFinishing.ts` F4 gate (1,124), S3 `WorktreeFinishingOwner`, `PendingMergesOwner`; F5 signals end with the splits.

**10. Graph work.** New `#module` `landing` (`dir` `apps/tagma/server/src/landing`, `depends-on` `projects`, `settings`, `thread-record`, `workspace`, `graph`, `change-record`, `enforcement`, `worktrees`). Its zone takes the merge, pull-request and queue half of [[af4f0ba5]], the landing claims of [[12972a3b]] (section 1 §1.13's §8.7 row) and decision [[45c0b92d]]'s merge side; task [[ef42cd77]] closes in this wave; task [[01ae8335]] (every agent commits its own lines) stays related. The merge-receipt and preservation claims are written from the new code at M3, never before (section 1: a target claim is not verified before its code exists).

**11. Acceptance.**
1. `landing/` imports only its needs; zero `modules` and `names` debt; `harness/submitWork.ts` and `working/WorktreeFinishing.ts` are gone.
2. A landing killed after the commit and before its receipt is answered at boot by the intent's key: the commit is found and recorded, never made twice.
3. From `threads M1` on, a merge writes its receipt and threads' merged note in one unit through `MergeNotice`; before it, the merged note is today's post-merge note, unchanged.
4. A queued merge whose worktree is archived is dropped in the archive unit through the retirement-settlement hook.
5. `submit_work` judges the prepared change through enforcement before publication, and the verdict equals `check_rules --over change`'s.
6. A run cannot open under a landing session mid-commit (task [[ef42cd77]]).

**12. Risks.**
- **Two files split across three modules.** The order is fixed by §7.4.4: worktrees takes the lifecycle parts at its M2, change-record's prepared change must stand before this wave's M1, and this wave moves the rest. A builder finding a part already gone reads 8 (a) of the receiving card.
- **The landing protocol is new durable state** on the hottest write path. The early `landing preservation` task lands the keyed archive intent, witness, receipt and boot driver before `worktrees M1`. `landing M1` reuses that publication and adds the remaining landing and merge protocol without making a second archive commit path.
- **`MERGE_TRAILER` is data** read back from git history by the merged-after check; its text must not change.

### 7.5.19 `sandbox`

**1. Ownership.** Isolated guest environments and prepared trees: preparing, exporting and releasing them (section 1 §1.3; now below `threads`). Directory `sandbox/`. Glossary words owned: **sandbox** (a guest and its record), **guest**, **guest backend** (the `sandbox` kind of `EnvironmentBackend`), **container engine** (Docker today, section 5), **prepared tree**, **export** (a guest's tree leaving as a sealed archive), **import** (guest files read into a checkout).

**2. Wave.** W5, level 8. Its **W2a store step** runs first: `sandbox` and `prepared_tree` leave `db/` into `sandbox/store/tables.ts` (the `sandbox` row binds a thread). The wave opens after projects, thread-record, workspace, change-record, executions and installation M1; runs beside `enforcement`, `performance`, `worktrees`. Carries the guest environment backend (section 5 A3), the `ReadStillness` port (declared here, implemented by threads), the thread-resource adapter's move to threads (Astra C11), and K2 for the sandbox routes. `threads` needs its M1 (the guest bind in birth is a C2 participant).

**3. Offers.**
- `contract/wire/` — `sandbox.ts` (limits, image, sources — `ProjectSnapshot`, `EmptyTree`, `PreparedSeed` — manifest, states, `SandboxRecord`, preparation, export, reconciliation); `preparedTree.ts` (recipe, network, manifest, receipt, states, records); `operations.ts` (`prepare_sandbox`, `read_sandbox`, `release_sandbox`, `build_prepared_tree`, `read_prepared_tree`, `release_prepared_tree`, `import_output`).
- `contract/service/` — `sandboxes.ts` (`Sandboxes` ← `SandboxOwner`: prepare, admit, bind, acquire a world, read a source file, release, discard); `preparedTrees.ts` (`PreparedTrees` ← `PreparedTreeOwner`); `installation.ts` (`InstallationLabel` ← `HostIdentity`, its field `id` ← `ownerId`: which installation's containers, networks and volumes these are — the Docker label value is data and stays).
- **Implements:** workspace's `EnvironmentBackend` for the `sandbox` kind.
- **Participant:** threads' birth unit (the guest bind, C2; `BirthBinding` removed — section 1 §1.13).
- **Port declared:** **`ReadStillness`** ← implemented by threads (hold a bound session quiet while a guest is read or exported).
- **Manifest:** its tables, operations, CLI verb `sandbox`, the boot condemnation and reconcile passes.

**4. Needs.** `platform` (adapter+service: the container runtime process calls, archives, units); `projects` (key-ref); `thread-record` (key-ref: the bound thread); `workspace` (the snapshot source, the import destination proof, the backend hook); `change-record` (record an imported write); `executions` (the execution world transport); `installation` (the runtime artifact, the carried helper sources).

**5. Tables** (machine store; names kept): `sandbox`, `prepared_tree`. W2a moves them; D4 re-points `sandbox`'s thread key at `thread_record` (participant). The store crossing helpers `stored`, `trusted` (today threads' `thread/portCrossing.ts`) come from platform (section 1 appendix B).

**6. Lanes, resources, passes.** One release per sandbox per server (claim [[d3eb3f83]]); per-sandbox semaphores and read counts; in-flight copies per prepared tree; the build's network grant (a private network with an allowlisted CONNECT proxy); the helper channel per guest; the archive transfer idle watch. Passes (rule [[a00f91b0]]): boot condemnation of unfinished sandboxes and trees, reconciliation against the engine's inventory, finishing interrupted releases.

**7. Operations.** The seven of 3 (names unchanged). Routes (K2): `api/sandboxes.ts` (5) and `api/preparedTrees.ts` (4) map one to one onto them. CLI verb `sandbox` (`list`, `run`: a thread born bound to a sandbox, through threads' birth operation).

**8. Target file map.**

*(a) Files whose primary owner is `sandbox`* (34 files, 6,356 lines). Paths relative to `sandbox/`.

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `db/sandbox.ts`, `db/preparedTree.ts` | 65 | `store/tables.ts` (W2a) | `project` via projects' contract |
| `harness/sandbox/SandboxStore.ts`, `PreparedTreeStore.ts` | 349 | `store/sandboxes.ts`, `store/preparedTrees.ts` | F2 cleared; `stored`, `trusted` from platform |
| `harness/sandbox/Sandboxes.ts` | 826 | split (F3, F4 gate): `guests/prepare.ts` (L102–224: prepare, admit, bind); `guests/lease.ts` (L226–296: ready, acquire, world, the guest backend); `guests/reads.ts` (L331–411: single-file reads, stillness); `guests/release.ts` (L419–527, L669–736: release, discard, cleanup, boot, reconcile, finishing a release, export); `guests/build.ts` (L535–667, L738–774: the build, copy, settle, snapshot, dependency digest, tree reading) | `SandboxOwner` → tag `Sandboxes`; `HostIdentity` → `InstallationLabel`; `SANDBOX_HOST_KIND` → the `sandbox` `EnvironmentKind` literal (it names the guest backend's kind) |
| `harness/sandbox/PreparedTrees.ts` | 411 | `trees/preparedTrees.ts` | `PreparedTreeOwner` → tag `PreparedTrees`; F4 watch |
| `harness/sandbox/PreparationRuntime.ts`, `SandboxRuntime.ts` | 106 | `contract/service/backends.ts` | `SandboxRuntime` → `GuestRuntime`, `PreparationRuntime` kept; `SandboxUnavailable`, `SandboxWorld` kept (boundary names keep the module word) |
| `harness/sandbox/archive.ts`, `snapshot.ts` | 484 | `trees/archive.ts`, `trees/snapshot.ts` | `TAGMA_OWN_GIT` stays (external name) |
| `harness/sandbox/guestImports.ts` | 105 | `guests/imports.ts` | stillness through `ReadStillness`; the running-session read of the machine store removed (it becomes the port's answer) |
| `harness/sandbox/docker/DockerSandboxes.ts`, `DockerPreparation.ts` | 857 | `engine/docker/guests.ts`, `engine/docker/preparation.ts` | `DockerSandboxes` → `DockerGuests`; `DockerPreparation` kept; F2 cleared by the stems; F4 watch on the first |
| `harness/sandbox/docker/GuestChannel.ts`, `GuestExec.ts`, `GuestFiles.ts`, `guestWire.ts`, `guest.ts`, `guestContainer.ts`, `guestImage.ts`, `guestLayout.ts`, `dockerWorld.ts`, `preparationNetwork.ts`, `proxy.ts`, `transfer.ts` | 2,076 | `engine/docker/channel.ts`, `exec.ts`, `files.ts`, `wire.ts`, `helper.ts` (← `guest.ts`: the program run inside the guest; its path is data in the image build and changes with it), `container.ts`, `image.ts`, `layout.ts`, `world.ts`, `network.ts`, `proxy.ts`, `transfer.ts` | `dockerWorld` → `dockerGuestWorld` kept as the one export; `OWNER_LABEL` → `INSTALLATION_LABEL` (the label key string is data and stays) |
| `harness/sandbox/docker/dockerSuite.ts` | 23 | `engine/docker/suite.ts` | test door; `dockerAnswers` kept |
| `harness/sandbox/sandboxFixture.ts`, `preparedTreeFixture.ts` | 293 | composition's test world | they write `project` and `thread` rows and read native-harness' `ThreadStore` (appendix B) |
| `harness/resources/sandbox.ts` | 16 | → **`threads`** (territory correction, §7.6) | the thread-resource adapter for guests (Astra C11): threads' resource kinds call `Sandboxes.discard` |
| `operations/sandbox.ts` | 480 | `operations.ts` (F4 watch) | `CHECKOUT_DIRECTORY` → the `graphDirectory` argument `composition` passes; imports land through change-record's recorded write |
| `protocol/operations/sandbox.ts`, `protocol/sandbox.ts`, `protocol/preparedTree.ts` | 444 | `contract/wire/operations.ts`, `sandbox.ts`, `preparedTree.ts` | F5 signals |
| `cli/commands/sandbox.ts` | 78 | `cli/sandbox.ts`, declared in `sandbox/cli.ts` | platform's verb contract |

*(b) Parts received:* none beyond the store helpers from platform. 

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `doctrine/sections/` (threads, 7.5.20): `theSandboxTree.ts` → `sandbox/doctrine/<same stem>.ts`, contributed through the doctrine hook (ids unchanged)

*(c) Symbols renamed:* `SandboxOwner` → `Sandboxes`; `PreparedTreeOwner` → `PreparedTrees`; `HostIdentity` → `InstallationLabel` (`ownerId` → `id`); `OWNER_LABEL` → `INSTALLATION_LABEL`; `DockerSandboxes` → `DockerGuests`; `SandboxRuntime` → `GuestRuntime`. Frozen: both tables, container, volume and network label keys and values, image revision labels, the helper's wire, refusal codes. *(d) Leaves:* `harness/resources/sandbox.ts` → threads; the two fixtures → composition.

**9. Debt retired.** `modules`: `sandbox → threads` (4: the stores' crossing helpers → platform; the fixtures → composition); `sandbox → cli` (2); `sandbox → native-harness` (1: `sandboxFixture.ts` → composition); `sandbox → graph` (`project` by projects' key; `CHECKOUT_DIRECTORY` by the `graphDirectory` argument). `names`: `Sandboxes.ts` F3, F4 gate (826), S3 `SandboxOwner`; `PreparedTrees.ts` S3 `PreparedTreeOwner`; F2 — `SandboxRuntime.ts`, `SandboxStore.ts`, `DockerPreparation.ts`, `DockerSandboxes.ts`, `dockerSuite.ts`, `dockerWorld.ts`, `sandboxFixture.ts`.

**10. Graph work.** The area [[3b8682f2]] "The sandbox a guest works in" becomes the zone of `#module` `sandbox` (`dir` `apps/tagma/server/src/sandbox`, `depends-on` `projects`, `thread-record`, `workspace`, `change-record`, `executions`, `installation`), with the binding claims going to threads (section 1 §1.13's §8.7 row); [[4c32fb5a]] "Releasing a sandbox guest" becomes its area; claims [[66ec2a1e]], [[157e02bb]], [[d3eb3f83]], [[463cb1a8]], [[b334a875]], [[08a29c70]] re-anchor at M2. Task [[c0e81e53]] (claims of the sandbox and the world a command runs in) splits: the world half is executions'.

**11. Acceptance.**
1. `sandbox/` imports only its needs; zero `modules` and `names` debt.
2. A thread born bound to a sandbox binds in threads' birth unit; racing births leave one holder.
3. Opening a guest environment goes through workspace's backend hook; refused and lost stay distinct.
4. Reading a bound guest holds its session quiet through `ReadStillness`; with the port unbound, the read refuses.
5. A release killed mid-export finishes at boot; a guest whose tree could not be exported keeps its container and volume (claim [[157e02bb]]).
6. The Docker system suites skip where no daemon answers (rule [[99b9fa72]]'s layer).

**12. Risks.**
- **Docker suites are system tests** (`*.stest.ts`), run at worktree merge only; the builder runs them once at M2 on a machine with a daemon and says so in the wave report.
- **The helper program's path is baked into the image revision digest.** Renaming `guest.ts` changes the digest and rebuilds the image; the wave accepts one rebuild and checks that images of the old revision are refused by label, as today.

### 7.5.20 `threads`

**1. Ownership.** The life of every thread whatever runs it: its mandate (authority, rights, delegation), birth and placement, messages between threads and the work handed to them — a worktree's base update included —, collaboration, resources, the journal and its rollout lane, ending, listing, the agent library, doctrine, standing permissions — and the `Harness` contract (section 1 §1.3; "standing" → **mandate**, section 5 A2). Directory `threads/`. Glossary words owned: **harness** (the concept, the `Harness` port and registry), **mandate**, **delegation**, **birth**, **placement**, **target** (where a thread works at a generation), **inbox**, **resource** (what a thread holds and releases), **journal**, **rollout** (the journal file), **rest** and **wake**, **agent library**, **doctrine**, **permission rule**.

**2. Wave.** W6, level 10. Its **W2a store step** runs first (the journal, inbox, claims, resources, permission rules, live spells, seen marks and target intents leave `db/thread.ts` into `threads/store/tables.ts`), and D4 (thread-record's migration) creates `thread_mandate` and re-keys the journal. The wave opens after landing and sandbox M1 (and everything below). It carries, in this order: **the `packages/agent` cut** (the collaboration kit's thread catalog and runtime ports — section 1 §1.2, versioned by section 6 — with the kernel's hidden native default removed and today's runner supplied explicitly through `Harness` by `composition` until `native-harness M1` (§7.2.7), §7.2.4); the **`Harness` port and registry** with its conformance suite (section 1 §1.9); the journal and its rollout lane (**D3**'s lane part, **E3**); `thread_mandate`; D6's `approval_preference`; the removal-hold contribution; `markHeld` → change-record's `heldChanged`; K2 for the thread routes. Both harness waves open at its M1.

**3. Offers.**
- `contract/wire/` — `threads.ts` (← `harness/protocol.ts` without the product prefix: list entries, sweeps, pages, windows, composition, held, list feed, agent types, delegation, place, wire snapshots and states, feed events); `selection.ts` (← `protocol/threadSelection.ts`: `ThreadSelectionQuery`); `target.ts` (← `protocol/threadTarget.ts`, with `TargetSnapshot`, `GraphOrigin` and their projections from workspace, 7.5.6); `agentLibrary.ts`; `titles.ts` (the title generation result from `protocol/threadTitle.ts`, 7.5.5); `operations/threads.ts`, `operations/agents.ts`, `operations/doctrine.ts`.
- `contract/service/` — **`harness.ts`** (the `Harness` port: `born`, `begin`, `current` ← `standing`, stop, continue, the outcomes of section 1 §1.2 and section 5 A2; `HarnessRegistry`); `acts.ts` (`ThreadActs`); `list.ts` (`ThreadList`); `journal.ts` (`ThreadEventLog`, the rollout lane `ThreadRollouts`); `inbox.ts`; `resources.ts` (the resource ledger and the resource-kind registry); `library.ts` (`AgentLibrary`); `permissions.ts` (`PermissionRules`); `mandate.ts` (the mandate row's reads and writes); `doctrine.ts` (the section registry and the contribution hook).
- **Ports implemented:** change-record's carrier admission; executions' `NoticeTakeBack`; landing's `MergeNotice`; sandbox's `ReadStillness`.
- **Hooks filled:** projects' `RemovalHold` (standing threads refuse a project removal); worktrees' placed-threads hook.
- **Hooks declared (start-bound):** **`Harness` implementations** ← native-harness, external-harnesses; **agent library entries** and **resource kinds** ← the harnesses; **doctrine sections** ← each module that describes its own contract (below).
- **Events:** the list feed, `threadBorn`, `threadEnded`, the journal's appended positions (the export ledger's source).
- **Keys:** the `agent.*` delegation, placement, approval and title keys (settings card's `threads` row).

**4. Needs.** `platform` (units, `HarnessId`, `SessionRef`); `projects` (key-ref, removal hold); `settings` (delegation, placement and title keys); `providers` (the model a title is asked of); `thread-record` (participant: the record in birth; `phasePublished`, `titleRecorded`); `workspace` (participant: assignments in birth and target change); `graph` (the scope block a thread is born under; graph's doctrine sections); `change-record` (held paths, `heldChanged`); `executions` (terminal resource release); `worktrees` (prepare or create a worktree for a birth; the record and finishing gate for a base update); `landing` (merge receipts, `mergeSettled`); `sandbox` (the guest bind in birth, C2). **No import of either harness** (section 1 rule: `threads` builds with no native run service).

**5. Tables** (machine store): `thread_mandate` (new, D4: `authority`, `rights`, `budget_tokens`, `host_*` from `thread`, `delegation` from `thread`); `thread_inbox`, `harness_delivery_claim`, `thread_resource`, `thread_event`, `thread_rollout_cursor`, `thread_rollout_refusal`, `thread_export` (new, D3); `permission_rule` ← `thread_owner_rule`, `permission_rule_withdrawal` ← `thread_owner_rule_withdrawn` (D6); `thread_target_intent` ← `thread_target_operation`; `thread_live_spell` ← `thread_live_spell`, `thread_seen` ← `thread_seen` (D4); `approval_preference` (new, D6, from `thread_owner_settings`). With `perf E5` ([[9c085c6c]] §3.13.10): the authoritative records whose contract is threads' — `thread_inbox.request_digest`, `thread_call(actor, operation, key, thread_id, digest, result, at)`, `spent_call_key`, `spent_epoch`, the tombstones `delete_thread` writes in its own unit before its cascade, and the meaning of the `applied_seq`, `applied_digest`, `start_digest` columns native-harness' `thread_run` carries. The renames ride D4 and D6 (section 2); this wave's own migration is none beyond them.

**6. Lanes, resources, passes.** The rollout lane (D3, E3: export in the append unit's ledger, rest on idleness, wake in units bounded by bytes and parameters — claims [[31d5f7b8]], [[208c5d66]]); the rested-read fold and revision caches (bounded by bytes); the idle sweep; boot replay and repair of rollouts; command-ending delivery (drive, redrive, boot resume of owed endings); custody notices; the delegation republish on a machine switch; the list's activity projection. Every one of these is started at layer start (rule [[a00f91b0]]); the cadences of `harness/rhythm.ts` stay the one table they read.

**7. Operations.** Owned (section 1 §1.13): `list_threads`, `read_thread`, `read_thread_record`, `read_thread_rollout`, `repair_thread_rollout`, `answer_ask`, `cancel_ask`, `continue_thread`, `archive_thread`, `archive_threads`, `pin_thread`, `move_thread`, `delete_thread`, `set_thread_delegation`, `generate_thread_title`, `adopt_thread_title`, `read_agent_library`, `read_agent`, `update_worktree` and the collaboration operations, dispatching through `Harness` where the thread's runtime or record answers. New: `create_thread`, `list_thread_window`, `list_thread_types`, `locate_thread`, `mark_thread_seen`, `set_thread_title`. Leave: `read_changes` → change-record; `read_compaction_choices`, `refresh_thread_instructions`, the context action `compact`, `read_thread_agent`, `save_agent` and the model-preference and evidence reads → native-harness. CLI verbs: `threads`, `permissions`, and the turn verbs of today's `harness` verb (7.5.22 (d)).

Routes (K2). All 37 routes of `api/threads.ts` (`ThreadsGroup`), read with their handlers in `http/handlers/threads.ts` at the baseline. **No typed route retires before its replacement stands:** the operation exists, K5a's aliases and answer versions carry it, and the app's generated route reads it in the same build; until then the typed route stays and calls the operation. New operation names follow section 5 §5.4.6's grammar and are reviewed with the card.

| Route (handler) | Today | Outcome | Owner |
|---|---|---|---|
| `list` | `list_threads` | `list_threads` | threads |
| `create` | birth through `ThreadActs.create` | new `create_thread` (the operator's birth; an agent's birth stays the collaboration operations) | threads |
| `roots` | `ThreadList.listWindow` | new `list_thread_window` | threads |
| `types` | `acts.types` | new `list_thread_types` (the library's types for the caller: operator or agent) | threads |
| `defaults`, `setDefaults` | `AccountDefaults` (model defaults) | new `read_model_defaults`, `set_model_defaults` over `model_preference` (D6) | native-harness |
| `favorites`, `setFavorites` | `AccountDefaults` (model favourites) | new `read_model_favorites`, `set_model_favorites` over `model_preference` | native-harness |
| `setModel` | `AccountDefaults` | `set_thread_model` (K6) | native-harness |
| `snapshot` | `ThreadEvidence.snapshot` | new `read_thread_snapshot` | native-harness |
| `held` | `ThreadEvidence.held` | new `read_thread_held` | native-harness |
| `composition` | `ThreadEvidence.composition` | new `read_thread_composition` | native-harness |
| `trace` | `ThreadEvidence.trace` | new `read_thread_trace` | native-harness |
| `compactionChoices` | `read_compaction_choices` | `read_compaction_choices` | native-harness |
| `refreshInstructions` | `ThreadActs.refreshInstructions` | `refresh_thread_instructions` (native context action; an external thread refuses `external-context`) | native-harness |
| `locate` | `ThreadList.row` | new `locate_thread` | threads |
| `shape` | `read_thread` (shape kind) | `read_thread` | threads |
| `query` | `ThreadEvidence.resolve`/`query`, operator actor | `read_thread` (its query form; the evidence it reads is native-harness's, reached as today) | threads |
| `expand` | `read_thread_record` | `read_thread_record` | threads |
| `rollout`, `repair` | `read_thread_rollout`, `repair_thread_rollout` | the same | threads |
| `see` | `ThreadActs.see` | new `mark_thread_seen` (`thread_seen`) | threads |
| `sweep` (`/api/threads/archive`) | `archive_threads` | `archive_threads` | threads |
| `setArchived` | `archive_thread` with `archived` | `archive_thread` | threads |
| `setPinned` | `pin_thread` | `pin_thread` | threads |
| `move` | `move_thread` | `move_thread` | threads |
| `setDelegation` | `set_thread_delegation` | `set_thread_delegation` | threads |
| `setTitle` | `defaults.setTitle` | new `set_thread_title` (a manual title, written through thread-record's title service) | threads |
| `generateTitle`, `adoptTitle` | `generate_thread_title`, `adopt_thread_title` | the same | threads |
| `remove` | `delete_thread` | `delete_thread` | threads |
| `answerAsk`, `cancelAsk` | `answer_ask`, `cancel_ask` | the same | threads |
| `speakHarness` | `speak_harness` | `speak_harness` | external-harnesses |
| `screenText` | `read_harness_screen` | `read_harness_screen` | external-harnesses |
| `upload` (binary request body, L380) | `ThreadActs` attachments | **retained HTTP resource**: a binary upload is not an operation answer; the route stays typed, owned by `resources/attachments.ts`, and `socket`/`cli` do not carry it | threads |
| `attachment` (binary answer, `HttpServerResponse.uint8Array`, L392) | `ThreadActs` attachments | **retained HTTP resource**, as `upload` | threads |

`api/agents.ts` (5): `skills` → **`read_agent_skills`** (new, **native-harness**: the face is declared in today's `harness/AgentLibrary.ts` L9, but its only implementation, `harness/agents/library.ts` L132–166, is the native skill pool over workspace sources and the `load_skill` capability — author-read; the face leaves threads' library for native-harness's contract); `list` → `read_agent_library`; `preview` → `read_agent`; `save` → `save_agent` (native-harness); `thread` → `read_thread_agent` (native-harness).

Count: 37 thread routes — 21 onto existing operations (16 threads', 3 native-harness's — `setModel`, `compactionChoices`, `refreshInstructions` — and 2 external-harnesses'), 14 onto 14 new operations, 2 retained binary resources.

**Contracts of the new operations** (author-read from `api/threads.ts` and `api/agents.ts` at the baseline; the schema names lose `tagma` by S2 and keep their shapes; `lens` is the call's project lens, which K1's admission supplies instead of a query field; every operation below refuses with `refusalSchema`, and those that name a thread also with `missingSchema`):

| Operation | Input | Answer |
|---|---|---|
| `create_thread` | `threadCreateSchema` | `threadCreatedSchema` |
| `list_thread_window` | `{ readerBefore?: string }` | `threadListWindowSchema` (← `threadListWindowSchema`) |
| `list_thread_types` | `{}` (the caller's kind, operator or agent, from admission) | `threadTypesSchema` |
| `read_model_defaults`, `set_model_defaults` | `{}`; `modelDefaultsWriteSchema` (← `modelDefaultsWriteSchema`) — both take the checkout scope `checkoutQuery` names today | `modelDefaultsSchema` (← `modelDefaultsSchema`) |
| `read_model_favorites`, `set_model_favorites` | `{}`; `favoriteModelsSchema` (← `favoriteModelsSchema`), same scope | `favoriteModelsSchema` |
| `read_thread_snapshot` | `{ threadId }` | `threadSnapshotPayloadSchema` (← `threadSnapshotPayloadSchema`) |
| `read_thread_held`, `read_thread_composition` | `{ threadId }` | `threadHeldSchema`, `threadCompositionSchema` |
| `read_thread_trace` | `{ threadId, run?: string }` | `runTraceSchema` (← `runTraceSchema`) |
| `locate_thread` | `{ threadId }` | `{ projectId: number }` |
| `mark_thread_seen` | `{ threadId } & threadSeenSchema` | `threadListEntrySchema` (← `threadListEntrySchema`) |
| `set_thread_title` | `{ threadId } & threadTitleSchema` | `threadSnapshotPayloadSchema` |
| `read_agent_skills` | `agentSkillAimSchema` (`{kind:'thread', id}` or `{kind:'draft', type?}`) | `agentSkillCatalogSchema` (`skills[{id, description}]`, `basis`, `available`, `note`) |

The answer versions start at 1 (K5a); a later shape change is an answer version, never a silent edit.

**The socket's thread act verbs become operations** (section 4 §4.4.3: act verbs are operations with `doors.socket` and carry a `callKey`; review D2). Today `socket/threadChannel.ts` L100–170 calls `ThreadActs` and `AccountDefaults` directly; the socket then calls these through invocation like every door. Each socket frame keeps `{ projectId: positive integer, threadId: nonempty string, params? }` and gains `callKey`; invocation takes the project from the admitted lens on other doors. Each answer uses the current `socket/rpc.ts` success schema. Every socket error is `refusalSchema` (today `asking` folds `ThreadActs`/`AccountDefaults` failures through `harnessRefusal` and `refusing`, `socket/threadChannel.ts` L27–36); the operation carries those same owner refusal codes and unblocks, not a new error schema. `thread.compact` also refuses `external-context`; `thread.model` retains `registeredProvider`'s `unknown-provider`. `missingSchema` belongs to the retained typed HTTP reads, not these socket acts. Each act is keyed. `send_message` stays the collaboration act that addresses **another** agent; `start_turn` opens a turn of the named thread.

| Verb today | Operation | Owner | Input (params) | Answer |
|---|---|---|---|---|
| `thread.send` | `start_turn` | threads (dispatch through `Harness`) | `threadSendSchema` | `threadSaidResultSchema` |
| `thread.queue` | `queue_turn` | threads | `threadSendSchema` | `threadSaidResultSchema` |
| `thread.steer` | `steer_turn` | threads | `threadSteerSchema` | `threadSteerResultSchema` |
| `thread.unqueue` | `unqueue_turn` | threads | `threadUnqueueSchema` | `threadUnqueueResultSchema` |
| `thread.answer` | `answer_question` | threads | `threadQuestionAnswerSchema` | `threadTurnResultSchema` |
| `thread.continue` | `continue_thread` (exists) | threads | — | `threadTurnResultSchema` |
| `thread.stop` | `stop_run` | threads | `threadStopSchema` (`runId`, `withdraw`) | `threadStopResultSchema` |
| `thread.authority` | `set_thread_authority` | threads (the mandate's authority mode) | `threadAuthoritySchema` | `threadSnapshotPayloadSchema` |
| `thread.compact` | `compact_thread` | native-harness (a native context action; an external thread refuses `external-context`) | `threadCompactSchema` (optional) | `threadCompactResultSchema` |
| `thread.model` | `set_thread_model` (K6) | native-harness | `threadModelSchema` | `threadSnapshotPayloadSchema` |

The read verbs `thread.entry` and `thread.entries` are native-harness' reads and stay socket request verbs over its feed. Publishing these ten operations is part of `threads M2` and `native-harness M2`, and `socket M2` waits on both (§7.2.2 rule 11).

**The journal lane** (accepted [[9c085c6c]] §3.13.15's amendment to section 1): threads' per-thread lane carries **every** journal append of **every** thread — native transitions and external appends alike — with export, rest, wake, repair and import; external entries skip only the native fold and its validation. Take-back, envelopes, `MergeNotice` and birth write no journal or fold input and are not lane entries; their snapshot publication is queued after commit, never awaited in their unit. Ranks 240/241 (the flush window and snapshot lane) become entry kinds of this lane. The routing of every append through the lane lands with `perf E5`.

**8. Target file map.**

*(a) Files whose primary owner is `threads`* (93 files, 12,886 lines). Paths relative to `threads/`.

*Acts, birth, list, targets:*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `harness/ThreadActs.ts` | 901 | split (F4 gate): `contract/service/acts.ts` (L80–225); `birth/acts.ts` (L234–477: delegation, child spawn, type, placement, host admission — dispatching to `Harness.born`, replacing today's `agentId === 'harness'` branch); `turns/acts.ts` (L479–557, L632–642, L702–728: send, queue, answer, cancel and answer asks, steer, unqueue, continue, stop, delete, see — through `Harness`); **to native-harness** — `compact` (L643–655) and `refreshInstructions` (L656–701), with `modelOnly` (L239–241) — baseline line numbers; the review cited L671–681 and L684–728 from the moved checkout `9fb0d559ee`, which is why the delta review runs first — as the native context actions of 7.5.21: the accepted `Harness` has no such faces (section 1 §1.4.3, section 4 §4.4.2), and a thread whose harness is external keeps today's refusal; **to external-harnesses** — speech and screen (L559–630), reports and answers (L730–847); `turns/attachments.ts` and `turns/recovery.ts` (L849–901) | the external parts reach threads only through the `Harness` port |
| `harness/ThreadEnding.ts` | 206 | `ending.ts` | harness session retire → `Harness.stop` |
| `harness/ThreadPlacement.ts` | 353 | `birth/placement.ts` | `ThreadPlacementOwner` → tag `ThreadPlacement`; prepare and create a worktree → worktrees' service (territory) |
| `harness/delegation.ts` | 70 | `birth/delegation.ts` | — |
| `harness/facetGate.ts` | 50 | `birth/projectGate.ts` | `gatedFacet` → `gatedByProject` (S7) |
| `harness/ThreadList.ts` | 433 | `list/rows.ts` | `markHeld` removed (`heldChanged`); `ThreadListRow`, `ThreadListPage`, `ThreadListWindow`, `ThreadsEvent`, `ThreadSweep` → without the product prefix (S2); archive's rest check → `Harness.current` |
| `harness/ThreadActivityFeed.ts` | 117 | `list/activity.ts` | — |
| `harness/wire.ts` | 540 | `list/wire.ts` | `wireHarness` → the harness's row detail, contributed by each harness (the facet projection leaves for external-harnesses); F4 watch |
| `harness/ThreadNaming.ts`, `ThreadTitles.ts`, `titleContext.ts` | 409 | `naming/generate.ts`, `naming/titles.ts`, `naming/context.ts` | `adopt` → external-harnesses' title adoption calls thread-record (7.5.5); the model aside is asked through providers |
| `harness/ThreadTargets.ts`, `TargetContexts.ts`, `ThreadMoves.ts` | 1,005 | `targets/decide.ts`, `targets/contexts.ts`, `targets/moves.ts` | `ThreadMovesOwner` → tag `ThreadMoves`; the kernel's generation asks reach the native run through `Harness` |
| `working/ThreadTargetOperationStore.ts` | 192 | `store/targetIntents.ts` | table `thread_target_intent` |
| `working/TargetSnapshotStore.ts` | 131 | → **native-harness** (`target_snapshot` is native-harness' table, 7.5.5) | — |
| `harness/WorktreeNotes.ts` | 120 | `journal/worktreeNotes.ts` | the merged note reads landing's merge receipt |
| `harness/threadTypes.ts`, `chosenModel.ts` | 81 | `library/types.ts`, `library/chosenModel.ts` | `chosenModel` asks the harness's model face through `Harness` |

*Journal, rollout, stores:*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `thread/ThreadEventLog.ts` | 313 | `journal/log.ts` | the journal: every thread's ordered events; payload kinds are their writers' |
| `files/ThreadRollout.ts`, `rolloutForms.ts` | 298 | `journal/rolloutFile.ts`, `journal/rolloutForms.ts` | — |
| `files/ThreadRolloutSync.ts` | 542 | split (territory): `journal/export.ts` (L97–275: facts, append, full export, meta); `journal/replay.ts` (the replay part of L469–542); **to native-harness** — the carry plan, row writes and rehydrate of the fold family (L277–467, the rehydrate part of L469–542) | F4 watch ends |
| `harness/ThreadRollouts.ts` | 433 | `journal/lane.ts` | evicting and rehydrating the fold family → native-harness' record part, called through `Harness` |
| `files/ThreadEviction.ts` | 123 | `journal/rest.ts` | the fold-family row deletion → native-harness' part |
| `thread/ThreadRolloutReads.ts` | 379 | split: `journal/restedReads.ts` (L91–144, L302–379: events, revisions, positions, codecs); **to native-harness** — the fold and its cache (L53–89 facet and folded source, L146–300) | the facet read → external-harnesses' session record |
| `thread/ThreadRolloutRepair.ts`, `ThreadRolloutReport.ts` | 257 | `journal/repair.ts`, `journal/report.ts` | — |
| `thread/ThreadInboxStore.ts` | 392 | `store/inbox.ts` | kernel port name `ThreadInbox` kept |
| `thread/ThreadResourceStore.ts` | 71 | `store/resources.ts` | — |
| `thread/ThreadOwnerRulesStore.ts` | 107 | `store/permissionRules.ts` | `ThreadOwnerRulesStore` → `PermissionRuleStore`; table `permission_rule` |
| `thread/ThreadDirectoryStore.ts` | 120 | `store/directory.ts` | reads `thread_record_facts` and `Harness.current` instead of `thread`, `thread_run` (kernel port name kept) |
| `thread/ThreadScratch.ts`, `ThreadAttachmentStore.ts` | 247 | `resources/scratch.ts`, `resources/attachments.ts` | F2 cleared |
| `thread/portCrossing.ts` | 38 | → **platform** `store/crossing.ts`, exposed through `contract/service/store.ts` (appendix B: store crossing helpers) | — |
| `thread/storageHarness.ts` | 71 | composition's test world | the conformance harness seeds several modules' rows |
| `harness/resources/attachments.ts`, `evict.ts`, `hold.ts`, `rollout.ts`, `scratch.ts`, `terminal.ts` | 166 | `resources/kinds/*` | with `sandbox.ts` from sandbox (7.5.19) |

*Collaboration, permissions, library, doctrine, operations:*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `harness/CommandDelivery.ts`, `commandSignalSend.ts`, `takeOverNotice.ts`, `commandTimes.ts` | 463 | `collaboration/commandEndings.ts`, `collaboration/signals.ts` (the `NoticeTakeBack` implementation), `collaboration/custodyNotices.ts`, `collaboration/commandTimes.ts` | the kernel's signal acts reach the run through `Harness` |
| `harness/PermissionRules.ts` | 64 | `permissions/rules.ts` | the operator's rules keep the credential principal (section 5: `owner` → principal) |
| `harness/AgentLibrary.ts`, `harness/agents/declared/DeclaredAgents.ts` | 224 | `library/service.ts`, `library/declared.ts` | `DeclaredAgents` kept (the catalog); harness spawn types arrive as library entries |
| `harness/refusal.ts` | 246 | `refusals.ts` | — |
| `harness/rhythm.ts` | 41 | `rhythm.ts` | F5 signal |
| `doctrine/render.ts`, `sections.ts`, `assemblies.ts`, `protocol/operations/doctrine.ts` | 344 | `doctrine/render.ts`, `doctrine/registry.ts`, `doctrine/assemblies.ts`, `doctrine/operationsSection.ts` | `OPERATION_OWNERS` derived from the manifests (composition hands the list in; `OperationId` from platform) |
| `doctrine/sections/*` (27 files) | 689 | by the contract each describes, contributed through the doctrine hook: **threads** — `agentDefinitions`, `answering`, `deciding`, `delegation`, `orchestration`, `preamble`, `refusals`, `threadsAsEvidence`, `writing`; **graph** — `aimingARead`, `blockReferences`, `general`, `graphEvidence`, `graphReading`, `graphRefusals`, `graphWriting`, `review`, `scopeBrief`, `theCheckoutAndTheGraph`, `theLongLivedBranch`, `whatTagmaIs`; **landing** — `gitAndGithub`; **change-record** — `theSharedCheckout`; **mcp** — `mcpServers`; **sandbox** — `theSandboxTree`; **installation** — `wiringARepository`; **native-harness** — `keepWarm`, `typedTools` | a section module moves to `<owner>/doctrine/<section>.ts`; its id stays (ids are data in assemblies) |
| `operations/session.ts` | 755 | split (F4 gate): `operations/reads.ts` (L55–300, L524–602); `operations/acts.ts` (L301–522 without `refresh_thread_instructions`); `read_changes` (L604–739) → change-record; `read_compaction_choices` (L740–754), `refresh_thread_instructions` → native-harness | `HolderStores` (workspace's holders) gone |
| `operations/agents.ts` | 126 | `operations/agents.ts` (`read_agent_library`, `read_agent`); `read_thread_agent`, `save_agent` → native-harness | — |
| `protocol/operations/session.ts` | 662 | split (F4 gate): `contract/wire/operations/threads.ts`; `read_changes` → change-record; `read_compaction_choices`, `refresh_thread_instructions` → native-harness | `SESSION_OPERATIONS`, `SessionOperationId`, `SESSION_OPERATION_IDS` → `THREAD_OPERATIONS`, `ThreadOperationId`, `THREAD_OPERATION_IDS` |
| `protocol/operations/agents.ts`, `protocol/agentLibrary.ts` | 168 | `contract/wire/operations/agents.ts`, `contract/wire/agentLibrary.ts` | the native two operations' declarations → native-harness |
| `protocol/threadSelection.ts`, `protocol/threadTarget.ts` | 179 | `contract/wire/selection.ts`, `contract/wire/target.ts` | `ThreadTargetOperationKey` (`threadTarget.ts:8`) → platform's `RequestKey` (section 5 §5.4.3) |
| `harness/protocol.ts` | 367 | `contract/wire/threads.ts` | the 25 `*` names drop the prefix (S2); `ThreadOutcomeStatusProjectsForm` → `ThreadOutcomeStatusMatches` (S1, as 7.5.5); the harness facet schema leaves for external-harnesses |
| `cli/commands/threads.ts`, `cli/commands/permissions.ts` | 334 | `cli/threads.ts`, `cli/permissions.ts`, declared in `threads/cli.ts` | platform's verb contract |

*(b) Parts received:* from `db/thread.ts` (thread-record) the tables of 5 (W2a); from `harness/ThreadStore.ts` (native-harness) the thread catalog and list reads (section 1 appendix B: "the thread catalog and list reads → threads") and the mandate's reads and writes; `approval_preference` from `thread_owner_settings` (D6); the title generation result (7.5.5); `TargetSnapshot`, `GraphOrigin` (7.5.6); `updateFromBase` and the placed-thread handling of `WorktreeFinishing.ts` (7.5.18) → `collaboration/baseUpdate.ts`; `harness/resources/sandbox.ts` (7.5.19); the thread subjects of `protocol/session.ts` and `projectionRefusal.ts` (7.5.1, §7.6); the agent-list figures (7.5.1); `thread/ThreadFloor.ts` → `journal/rolloutWriter.ts` (`RolloutWriter`) and `thread/ThreadProjection.ts` → `journal/projection.ts` from native-harness (7.5.21, §7.6).

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `socket/threadChannel.ts` (socket, §7.6) → `list/feeds.ts` (the list feed and the thread feed with resume and replay), declared in threads' manifest; the warmth basis goes to native-harness
- from `protocol/pageFamilies.ts` (platform, 7.5.1): `THREADS` → `threads/contract/wire/pages.ts`
- from `protocol/numbers.ts` (platform, 7.5.1): `AGENT_LIST_ROW_BYTES`, `AGENT_LIST_MAX_ROWS`, `AGENT_LIST_ROWS` → beside its one reader, in the file of this card's (a) that reads it
- from `protocol/threadTitle.ts` (thread-record, 7.5.5): the title generation result → `contract/wire/titles.ts`
- from `cli/commands/harness.ts` (external-harnesses, corrected in §7.6): the turn verbs of native threads → `threads/cli/turns.ts`, declared in `threads/cli.ts`

*(c) Symbols renamed:* the 25 `*` wire names and `HarnessFailed` (S2); `ThreadOwnerRulesStore` → `PermissionRuleStore`; `ThreadMovesOwner`, `ThreadPlacementOwner` → their service names; `gatedFacet` → `gatedByProject`; `SESSION_*` → `THREAD_*`; `Harness.standing` → `Harness.current`. Frozen: event op names, the journal line format and its metadata line (a lost store is rebuilt from it — the legacy `{thread, facet, session}` envelope keeps parsing), table columns, operation names, permission subject strings.

*(d) Leaves:* the external-harness speech, screen and report acts → external-harnesses; the fold family's carry, rehydrate, eviction and cache → native-harness; `TargetSnapshotStore.ts` → native-harness; `read_changes` → change-record; the native operations → native-harness; doctrine sections → their owners; `portCrossing.ts` → platform; `storageHarness.ts` → composition.

**9. Debt retired.** `modules`: `threads → native-harness` (56) and `threads → external-harnesses` (34) by the `ThreadStore` split, the `Harness` port and registry, harness contributions to the library and row detail, the facet leaving the record; `threads → cli` (9) by platform's verb contract; `threads → composition` (1) by platform's brand. `names`: F4 gate — `ThreadActs.ts` (901), `operations/session.ts` (755), `protocol/operations/session.ts` (662); S2 — `harness/protocol.ts` (25 names), `ThreadList.ts` (5), `refusal.ts`, `threadSelection.ts`; S1 — `ThreadOutcomeStatusProjectsForm`; S3 — `ThreadMovesOwner`, `ThreadPlacementOwner`; S7 — `gatedFacet`; F2 — the ten `thread/Thread*` files and `DeclaredAgents.ts`.

**10. Graph work.** New `#module` `threads` (`dir` `apps/tagma/server/src/threads`, `depends-on` `projects`, `settings`, `providers`, `thread-record`, `workspace`, `graph`, `change-record`, `executions`, `worktrees`, `landing`, `sandbox`). The zones redraw by section 1 §1.13's §8.7 row: [[70db8905]] "The agent stack a thread runs in" dissolves (its placement, moves, notes, delegation and command-time claims come here); [[edd4a99c]] "The thread a reader sees" comes here for the journal, the rollout file and its lane, with the folds and evidence to native-harness; [[fc9c26d8]] "What a thread keeps, and when it rests" comes here with its fold-family claims split; [[df47ad01]] "Where a thread's records are stored" splits between threads (journal, inbox, resources, rules), native-harness (kernel rows) and thread-record; [[89df5e7a]]'s permission rules and library come here; [[e0ee2866]]'s delivery of detached results comes here; [[8ec9c71c]]'s doctrine part comes here, its vocabulary part stays graph's; [[376d1e0e]]'s target part comes here. Behavioural claims R1 (authority, rights, catalog) and R3 (`Harness` outcomes and leases) are written from the new code at M3.

**11. Acceptance.**
1. `threads/` imports neither harness; a build of `threads` with no native run service passes its suite.
2. Before `start` binds the harnesses, birth and every thread act refuse naming the unbound harness; a harness id no module registered refuses the birth, typed.
3. Both harnesses pass threads' conformance suite (section 1 §1.9).
4. A rest and a wake preserve a transcript's order (claim [[d3a828c1]]); a wake never holds the writer past its bound.
5. `thread_mandate` carries every thread's authority, rights, budget and delegation after D4; a spawned child inherits its mandate as today.
6. Zero `modules` and `names` debt over this card's own map; every file of its (a) is at its target and every part of its (b) is received. The files of `harness/`, `thread/` and `files/` that native-harness and external-harnesses still own stay at their old paths until those waves; this card does not wait for them.

**12. Risks.**
- **The `packages/agent` cut comes first** and changes the kernel's public surface; section 6 versions it, and this wave cannot open its `M1` before the cut lands.
- **`M1` must run.** At `threads M1` the `Harness` registry exists but neither harness has its own module yet. The `Harness` faces are bound to the old producers named in §7.2.7 (`born`, `folded`, `record`, `retract`; `quiet` lands later with its implementers), so every thread act keeps today's behaviour; `native-harness M1` and `external-harnesses M1` each replace their bindings. Acceptance 2 (refusal while unbound) is tested with `start` withholding a binding, never in the running product.
- **`ThreadActs.ts` and `ThreadStore.ts` are read on every turn.** The dispatch through `Harness` must add no read per act: `Harness.current` answers from the record's phase and the harness's own row, both already read today.
- **Doctrine ids are data.** Moving a section module must not change its id or its assembly position; the assemblies' overlap and duplicate checks run after each move.

### 7.5.21 `native-harness`

**1. Ownership.** Tagma's own agent runtime: runs native threads on the kernel with their instructions, tools, models, transcript, compaction and workflows (section 1 §1.3, new). Directory `native-harness/`. Glossary words owned: **native thread**, **run** (and its ledger), **transcript**, **model history**, **fold** (the transcript and history projections of the journal), **compaction**, **capability**, **skill**, **world state** (the turn's rendered sections), **keep-warm**, **call** (a live tool invocation of a native run), **workflow** (a saved composition of agents), **model preference**.

**2. Wave.** W6, level 11. Its **W2a store step** runs first (`thread` narrowed, `thread_run`, `thread_log`, `thread_history_item`, `thread_entry`, `thread_compaction_checkpoint`, `thread_pruned_tool_call`, `thread_cache_observation`, `target_snapshot`, `workflow_run` into `native-harness/store/tables.ts`; the run ledger's adapter publishes the phase in D4's change — 7.2.4). The wave opens after threads M1; runs beside `external-harnesses`. Carries D3's folds (the fold family on append, in the journal's units as a C2 participant), **E6**, the `ThreadExecution` port it declares (implemented by invocation) with the `afterEdit` ingress (section 4), the native context actions moved from `ThreadActs` (`compact`, `refreshInstructions` with `modelOnly`: an external thread refuses `external-context`, as today), the workspace-source reload, D6's `model_preference`, **K6** (`set_thread_model`), and the `Harness` implementation with its conformance run.

**3. Offers.**
- `contract/wire/` — `evidence.ts` and `trace.ts` (← `protocol/evidence.ts`: shape, records, queries, expansion, facts, rollout repair, the run trace), `toolResult.ts` (the native tool answers), `calls.ts`, `compactionChoices.ts`, `instructions.ts` (← `protocol/threadInstructions.ts`), `modelSelection.ts` (← `protocol/modelSelection.ts`, §7.6), `operations/*.ts` (calls, workflows, the native session operations, the two native agent operations).
- `contract/service/` — `harness.ts` (the native `Harness` implementation, registered with threads at `start`), `execution.ts` (**`ThreadExecution`**, a port this module **declares and consumes**: the per-caller tool catalog `tools`, `execute` (a tool call performed with the run's own grant) and the `afterEdit` ingress; **implemented by `invocation`**, bound by `composition` at `start`; until `invocation M1` binds its implementation, `composition` binds a transitional adapter over today's `operations/nativeTools.ts`), `state.ts` (`NativeThreadState`, `NativeThreadSnapshot` ← `ThreadState`, `ThreadSnapshot`), `evidence.ts` (`ThreadEvidence`), `calls.ts` (`CallActivity`), `workflows.ts` (`Workflows` ← `Workflows`).
- **Contributions to threads:** the `Harness` implementation (its record part: the native `thread` row in birth, the folds in the journal's units, the run ledger publishing phase with thread-record in one unit); agent library entries (`tagma`, `code`, `rules`, declared); resource kinds (`evidenceReads`, `toolOutputs`); doctrine sections `keepWarm`, `typedTools` (7.5.20).
- **Keys:** the agent, compaction, keep-warm and model keys (settings card's `native-harness` row).

**4. Needs.** `platform` (units, writer register, the call-voice envelope); `projects`; `settings`; `providers` (model runtime, account choice, quota); `thread-record` (participant: phase and running run); `workspace` (working bindings, roots of a world); `graph` (instructions and the law snapshot, the touch brief, the digest); `change-record` (record a native tool's writes); `power` (work counts); `mcp` (tools for native agents); `artifacts` (the artifact skill's shelf); `executions` (worlds, the commands a tool starts); `threads` (implements `Harness`; journal append in its units; the catalog, inbox, mandate, resources, delegation, library and doctrine). No import of `external-harnesses`.

**5. Tables** (machine store): `thread` (narrowed by D4: the kernel row — model, account, reasoning, profile, prompts, pending interaction, failure, cache group), `thread_run`, `thread_log`, `thread_history_item`, `thread_entry`, `thread_compaction_checkpoint`, `thread_pruned_tool_call`, `thread_cache_observation`, `target_snapshot`, `workflow_run`, **`model_preference`** (new, D6: model selection and favourites from `thread_owner_settings`). It writes `thread_event` only as a participant in threads' journal units (the folds' payload rewrites included). **With `perf E5`** (accepted [[9c085c6c]] §3.13.7.5, §3.13.15): a native transition commits its events, their aggregate fold and the row folds up to the new head in **one unit** through the kernel's keyed `transition` port, as an entry of threads' journal lane, and `Harness.folded` receives the prepared fold; the native `thread` row gains `fold_rev` (triggers on `thread_event`, every fold table, `thread_log` and the fold-read `thread` columns, `context_reading` among them — no-ops for an external thread) and `inherit_rev`; `thread_run` gains `applied_seq`, `applied_digest`, `start_digest`, whose contract is threads' (§3.13.10). The T0–T5 phase boundaries, `took` and the tool phases of §3.13's ledger are this module's (§3.13.10).

**6. Lanes, resources, passes.** The run ledger's reaping and hand-over; settled-notification claims; stall sighting; keep-warm (one timer per waiting thread); the maintenance passes over the journal's payloads (entry bounding, event stripping, footprint folding — each with its cursor in `thread_log`, freelist and incremental vacuum); the unit-scoped fold caches; the prompt cache (64 rendered prompts); evidence retention with a per-process HMAC; the workspace source cache. Every driver is started at layer start (rule [[a00f91b0]]); task [[fb659192]] (a workflow run abandoned by a dead driver is never re-driven) is kept and not broken.

**7. Operations.** `read_compaction_choices`, `refresh_thread_instructions`, `read_calls`, `control_call`, `set_thread_model` (K6, new), `save_agent`, `read_thread_agent` and the workflow operations (today's `api/workflows.ts` routes `catalog`, `runs`, `run` → `list_workflows`, `list_workflow_runs`, `start_workflow`, new). Routes (K2): `api/calls.ts` (2) → `read_calls`, `control_call`; `api/workflows.ts` (3) as above; the native thread routes of `api/threads.ts` as 7.5.20 enumerates them (`defaults`, `setDefaults`, `favorites`, `setFavorites` → new `read_model_defaults`, `set_model_defaults`, `read_model_favorites`, `set_model_favorites`; `setModel` → `set_thread_model`; `snapshot`, `held`, `composition`, `trace` → new `read_thread_snapshot`, `read_thread_held`, `read_thread_composition`, `read_thread_trace`; `compactionChoices`, `refreshInstructions`); from `api/settings.ts` (7.5.3) `workspaceInventory` → new `read_workspace_sources`, `reload` → new `reload_workspace_sources` (invalidates the workspace source cache and answers the inventory), `compactionSummarizers` → new `read_compaction_summarizers`; from `api/agents.ts` `save`, `thread` → `save_agent`, `read_thread_agent`, `skills` → new `read_agent_skills` (contract in 7.5.20's table). The native context action `compact` (from `ThreadActs`) is reached through the turn surface as today and refuses `external-context` for an external thread. CLI verb `workflow`.

**8. Target file map.**

*(a) Files whose primary owner is `native-harness`* (104 files, 16,066 lines). Paths relative to `native-harness/`.

*Rows and runs (`thread/`, `db/`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `harness/ThreadStore.ts` | 1,555 | **dissolves** by appendix B's split (F4 gate, S2 ×22): the record's reads and writes → thread-record (7.5.5 (b)); the thread catalog and list reads (L214–412 list SQL and row helpers, L538–726 facet-gated reads, L1425–1555 row mapping) → threads `list/queries.ts`; live spells and seen receipts (L1107–1219) → threads (`thread_live_spell`, `thread_seen`); the mandate and delegation (`standings`, `delegationLineage`, `setDelegation`) → threads; `placedIn`, `adoptedOn`, `adoptedIn` and the facet (`attachFacet`'s external part, `facetOf`) → external-harnesses; **native keeps** `rows/native.ts` (the native part of birth `attachFacet`/`inheritFacet` L421–536, `worldStateSnapshot`, `advanceWorldState`, `graphCursor`, `advanceGraphCursor`, `stalledRuns`) as `NativeThreadRows` | every `*` type drops the prefix or goes with its part |
| `thread/ThreadStore.ts` | 657 | split (F2, F4 gate): `rows/threadRow.ts` (L95–459: reads, birth, lifecycle lock, patches, interaction claims, append, delete, listings); `rows/threadUnits.ts` (L461–657: unit internals and row parsing) | `ThreadStore` keeps the kernel port's name |
| `thread/ThreadRunStore.ts` | 684 | split (F2, F4 gate): `runs/ledger.ts` (L62–368: create, resume, settle, stop, status, reads, running patches); `runs/reaping.ts` (L370–684: reaping, hand-over, cut, adopt, settled-notification claims, the owner fence) | the ledger publishes phase and `running_run_id` through `ThreadRecords.publishPhase` in the same unit |
| `harness/StallSighting.ts` | 25 | `runs/stalls.ts` | — |
| `thread/ThreadEntryFold.ts` | 665 | split (F2, F4 gate): `transcript/fold.ts` (L22–308: reads, window serving, suffix replay); `transcript/rows.ts` (L310–665: fold and restore, row writes, cached reads, page taking) | — |
| `thread/ThreadHistoryStore.ts` | 217 | `transcript/history.ts` | — |
| `db/foldedToolFact.ts`, `db/foldedFootprint.ts` | 93 | `transcript/foldedFacts.ts` | — |
| `thread/ThreadEntryBounding.ts`, `ThreadEventStripping.ts`, `ThreadFootprintFolding.ts` | 931 | `maintenance/bounding.ts`, `maintenance/stripping.ts`, `maintenance/footprints.ts` | they rewrite `thread_event` payloads (threads' table) through threads' journal service as a participant; `ThreadBounded`, `ThreadStripped`, `ThreadFolded` kept |
| `thread/ThreadCompactionStore.ts`, `ThreadCalibrationStore.ts` | 258 | `compaction/store.ts`, `compaction/calibration.ts` | — |
| `thread/ThreadCacheObservationStore.ts` | 119 | `models/cacheObservations.ts` | — |
| `thread/ThreadOwnerSettingsStore.ts` | 280 | split by D6: `models/preferences.ts` (model selection, switches, favourites → `model_preference`); approval mode → threads (`approval_preference`); default accounts → providers (7.5.4) | `ThreadOwnerSettingsStore` retires with its table |
| `thread/ThreadToolOutputStore.ts` | 303 | `tools/outputs.ts` | `ThreadToolOutputNotFoundError` → `ToolOutputMissing` (S1) |
| `thread/ThreadInputRecovery.ts`, `thread/pendingAsk.ts` | 164 | `turns/inputRecovery.ts`, `turns/pendingAsk.ts` | — |
| `thread/ThreadFloor.ts` | 231 | → **threads** `journal/rolloutWriter.ts` (territory correction, §7.6) | `ThreadFloorFile`, `ThreadFloorFaces`, `ThreadFloorError` → `RolloutWriter`, `RolloutWriterFaces`, `RolloutWriterError` (section 5: "floor" retired, rollout append → **rollout writer**); it mints journal positions for every thread |
| `thread/ThreadProjection.ts` | 229 | → **threads** `journal/projection.ts` (§7.6) | it projects rollout lines into `thread_event` with the cursor and refusal rows, all threads' |

*The run's turn, tools, agents (`harness/`):*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `harness/ThreadContext.ts`, `turnContext.ts`, `worldState.ts`, `guidanceState.ts`, `instructionDelivery.ts`, `commandRulesSection.ts`, `threadGraphs.ts` | 581 | `turns/context.ts`, `turns/message.ts`, `turns/worldState.ts`, `turns/guidance.ts`, `turns/instructions.ts`, `turns/commandRules.ts`, `turns/graphs.ts` | `WorldState`, `SkillSummary`, `worldStateSections` → without the prefix |
| `harness/WorkspaceSourceCache.ts`, `workspaceSources.ts` | 269 | `sources/cache.ts`, `sources/walk.ts` | — |
| `harness/AccountDefaults.ts` | 292 | `models/defaults.ts` | the face keeps model parts; `setAuthorityMode` → threads' mandate, `setTitle` → thread-record, `setDelegation` → threads, default account → providers — each a call through its owner |
| `harness/observeStepQuota.ts` | 19 | `models/quota.ts` | — |
| `harness/CompactionChoices.ts`, `compactionPolicy.ts` | 400 | `compaction/choices.ts`, `compaction/policy.ts` | `CompactionChoicesOwner` → tag `CompactionChoices` |
| `harness/KeepWarm.ts`, `KeepWarmReads.ts` | 368 | `keepWarm/driver.ts`, `keepWarm/reads.ts` | `KeepWarmSubject.foreign` → `external`; the CLI attention state is read through `Harness.current`, not the facet JSON |
| `harness/CallActivity.ts`, `CallDelivery.ts` | 131 | `calls/activity.ts`, `calls/delivery.ts` | — |
| `harness/EvidenceReads.ts` | 481 | `evidence/retained.ts` | F4 watch |
| `harness/ThreadEvidence.ts` | 968 | split (F4 gate): `evidence/threadEvidence.ts` (L77–182, L505–747); `evidence/reading.ts` (L205–504); `evidence/traceFacts.ts` (L749–968) | the ten `*` names drop the prefix; task [[b2c9c593]] (stop waking a thread before every read) kept |
| `harness/Workflows.ts`, `WorkflowRuns.ts`, `WorkflowSeams.ts`, `workflowSources.ts` | 426 | `workflows/library.ts`, `workflows/runs.ts`, `workflows/seams.ts`, `workflows/sources.ts` | — |
| `harness/agents/*` (15 files) | 1,086 | `agents/*`: `composeAgent.ts`, `effectiveAgent.ts`, `capabilityLoss.ts`, `declarations.ts`, `declaration.ts` (← `AgentDeclaration.ts`, F2), `library.ts` (the `AgentLibrary` face threads declares), `declared/files.ts` (← `AgentFiles.ts`), `declared/agent.ts`, `declared/base.ts`, and the three shipped agents by one rule — `harness/agents/<kind>/agent.ts` and `…/<kind>/identity.ts` → `native-harness/agents/<kind>/agent.ts`, `…/identity.ts` for `<kind>` ∈ {`code`, `tagma`, `rules`} (six files, stems kept: each `agent.ts` is one `AgentDeclaration` literal, 11–13 lines, author-read for `code`) | — |
| `doctrine/prompt.ts` | 40 | `agents/prompt.ts` | — |
| `harness/capabilities/*` — the 18 non-test files: `Capability.ts`, `index.ts`, `agents.ts`, `checkRule.ts`, `files.ts`, `graph.ts`, `mcp.ts`, `peers.ts`, `resources.ts`, `sandbox.ts`, `shell.ts`, `skills.ts`, `terminals.ts`, `threads.ts`, `touchRule.ts`, `web.ts`, `worktrees.ts`, `worldTools.ts` | 762 (measured `wc -l` at the baseline; v2's 725 was wrong) | `capabilities/`: `contract.ts` (← `Capability.ts`, F1), `table.ts` (← `index.ts`: a table, not a barrel), and the other sixteen at the same stem — `agents.ts`, `checkRule.ts`, `files.ts`, `graph.ts`, `mcp.ts`, `peers.ts`, `resources.ts`, `sandbox.ts`, `shell.ts`, `skills.ts`, `terminals.ts`, `threads.ts`, `touchRule.ts`, `web.ts`, `worktrees.ts`, `worldTools.ts` (tests follow, §7.4.3) | `settingsPermissionFloor`, `commandRulePermissionFloor`, `enforcementPermissionFloor`, `peersPermissionFloor`, `terminalPermissionFloor`, `threadsPermissionFloor` → `*PermissionBaseline` (section 5: floor → **baseline**); capabilities name operation ids contributed by their owners, not composition's union |
| `harness/artifactSkill.ts`, `clientPresentationSkill.ts`, `performanceSkill.ts`, `showcaseSkill.ts`, `skills.ts` | 676 | `skills/artifacts.ts`, `skills/clientPresentation.ts`, `skills/performance.ts`, `skills/showcase.ts`, `skills/pool.ts` | skill ids are data |
| `harness/mcpRule.ts`, `mcpServerTools.ts`, `nativeCatalog.ts`, `toolPresentation.ts`, `toolProjection.ts`, `WebSearch.ts` | 259 | `tools/mcpRule.ts`, `tools/mcpServers.ts`, `tools/catalog.ts`, `tools/presentation.ts`, `tools/projection.ts`, `tools/webSearch.ts` | `CollaborationToolName`, `KernelToolName`, `WorkspaceToolName`, `toolPresentation` → without the prefix |
| `harness/resources/evidenceReads.ts`, `toolOutputs.ts` | 35 | `resources/*`, contributed to threads' resource kinds | — |
| `harness/contract.ts` | 14 | `contract/service/state.ts` | `ThreadState`, `ThreadSnapshot` → `NativeThreadState`, `NativeThreadSnapshot` (the kernel's `ThreadState` is imported beside them) |
| `harness/captureDriver.ts` | 272 | composition's test world (`composition/testing/captureDriver.ts`, section 6 §6.8), with the corpus location passed in by its caller | — |

*Wire, voice, operations, CLI:*

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `protocol/evidence.ts` | 484 | split (F4 watch, F5 24): `contract/wire/evidence.ts` (L12–245, L425–484); `contract/wire/trace.ts` (L247–423) | 24 `*` names drop the prefix; `WorkspaceChange` → change-record's `ChangeRow` wire |
| `protocol/toolResult.ts` | 288 | `contract/wire/toolResult.ts` | 31 `Tool*`/`GraphToolResult` names → `Tool*`, `GraphToolResult`; the graph-owned answer shapes are graph's (7.5.7) and imported here. **Leave:** `ToolReflectionFiled` (L200–207) → graph `contract/wire/reflections.ts` as `ReflectionFiled`, `receivedBy: ProcessProvenance | null` (platform); the `vacuum` arm (`Vacuum`, L8) → installation's declared answer, reached through the manifest — so the file imports neither `protocol/source.ts` nor `protocol/database.ts` |
| `protocol/calls.ts`, `compactionChoices.ts`, `threadInstructions.ts`, `protocol/operations/calls.ts` | 165 | `contract/wire/calls.ts`, `compactionChoices.ts`, `instructions.ts`, `operations/calls.ts` | — |
| `projection/thread.ts` | 748 | split (F4 gate): `voice/threadText.ts` (L19–303: rows, facts, shape, evidence text); `voice/sessionTools.ts` (L306–551: the session tool result text and input types); `voice/sessionDisplay.ts` (L553–748) | `ThreadSelectorInput`, `SessionToolInput` → without the prefix |
| `projection/toolAnswer.ts` | 574 | split: `voice/graphTools.ts` (L32–339), `voice/graphDisplay.ts` (L341–574) | **Leave:** the vacuum text branch (L143) and display branch (L427–435) and the `vacuumText` import (L26) → installation's voice by manifest (7.5.9); the reflection receipt's text → graph's reflection voice by manifest (7.5.7). The voice asks the manifest for the operation's voice instead of branching on the answer's keys for those two |
| `projection/trace.ts`, `projection/callsAnswer.ts` | 210 | `voice/trace.ts`, `voice/calls.ts` | — |
| `operations/calls.ts` | 97 | `operations/calls.ts` | — |
| `cli/commands/workflows.ts` | 95 | `cli/workflows.ts`, declared in `native-harness/cli.ts` | platform's verb contract |

*(b) Parts received:* from `socket/threadChannel.ts` (socket, §7.6) the warmth basis of the thread feed → `evidence/warmth.ts`; from `harness/ThreadActs.ts` (threads) `compact` (L643–655), `refreshInstructions` (L656–701) and `modelOnly` (L239–241) → `context/actions.ts` (the native context actions; the `external-context` refusal kept); from `http/handlers/settings.ts` (http) the `workspaceInventory` and `reload` bodies (L34–44) → `sources/operations.ts` (`read_workspace_sources`, `reload_workspace_sources`); `socket/callChannel.ts` (socket, §7.6) → the calls feed in this module's manifest; `protocol/modelSelection.ts` (providers, corrected in §7.6), `DEFAULT_MODEL` (providers' `ai/Models.ts`), the rest of `AccountDefaults.ts` and `ThreadOwnerSettingsStore.ts`, `NATIVE_RUN_SCOPE` (7.5.5); the fold family's carry, rehydrate and eviction parts of `files/ThreadRolloutSync.ts`, `harness/ThreadRollouts.ts`, `files/ThreadEviction.ts` and the fold cache of `thread/ThreadRolloutReads.ts` (7.5.20) → `transcript/rest.ts`, called through `Harness`; `working/TargetSnapshotStore.ts` (threads) → `rows/targetSnapshots.ts`; the native operations of threads' files (`read_compaction_choices`, `refresh_thread_instructions`, `read_thread_agent`, `save_agent`); the envelope parts of `protocol/toolResult.ts` platform took in W0 (7.5.1).

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `doctrine/sections/` (threads, 7.5.20): `keepWarm.ts`, `typedTools.ts` → `native-harness/doctrine/<same stem>.ts`, contributed through the doctrine hook (ids unchanged)
- from `protocol/pageFamilies.ts` (platform, 7.5.1): `CALLS`, `COMPACTION_CHOICES` → `native-harness/contract/wire/pages.ts`

*(c) Symbols renamed:* the S2 names above (about 110 `*` identifiers across `ThreadStore`, `ThreadEvidence`, `evidence`, `toolResult`, `toolPresentation`, `worldState`, `contract`, the workflows and the voice files), `*PermissionFloor` → `*PermissionBaseline`, `CompactionChoicesOwner` → `CompactionChoices`, `ThreadToolOutputNotFoundError` → `ToolOutputMissing`, `KeepWarmSubject.foreign` → `external`. Frozen: every table and column, event payload kinds, agent and skill ids, capability ids, the evidence cursor format (signed per process).

*(d) Leaves:* `ThreadStore`'s parts to thread-record, threads and external-harnesses; `ThreadFloor.ts`, `ThreadProjection.ts` → threads; approval mode → threads; default accounts → providers; `captureDriver.ts` → composition.

**9. Debt retired.** `modules`: `native-harness → composition` (11) by `ThreadExecution.tools` from invocation, capability ids contributed by owners and platform's brand; `native-harness → external-harnesses` (10) by the facet leaving, skill directories as an argument and thread operations named by contribution; `native-harness → cli` (5) by platform's verb contract. `names`: F4 gate — `ThreadStore.ts` (1,555), `ThreadEvidence.ts` (968), `projection/thread.ts` (748), `ThreadRunStore.ts` (684), `ThreadEntryFold.ts` (665), `ThreadStore.ts` (657); F1 — `Capability.ts`; F2 — the 15 `thread/Thread*` files and `AgentDeclaration.ts`; S1 — `ThreadToolOutputNotFoundError`; S2 — the names of (c); S3 — `CompactionChoicesOwner`; S7 — `ThreadFloor*`, the six `*PermissionFloor`.

**10. Graph work.** New `#module` `native-harness` (`dir` `apps/tagma/server/src/native-harness`, `depends-on` per 4). By section 1 §1.13's §8.7 row: [[3ded8caa]] "The composition a Tagma thread runs in" and [[73faac5e]] "A saved composition of agents" come here; [[e0ee2866]]'s call lifecycle comes here (its detached-result delivery went to threads); [[89df5e7a]] "What a thread's tools may reach" comes here without its permission rules and library (threads); [[12972a3b]]'s workspace sources come here; the fold and evidence claims of [[edd4a99c]] come here; [[df47ad01]]'s kernel-row claims come here. Behavioural claims R2 (history per harness) and R6 (tool assembly and after-edit) are written from the new code at M3. Tasks kept: [[a9b2d65b]], [[0f5b0103]], [[b2c9c593]], [[fb659192]], [[327289e6]].

**11. Acceptance.**
1. `native-harness/` imports no `external-harnesses` file; zero `modules` and `names` debt.
2. The native `Harness` passes threads' conformance suite; a native run's phase and run row change in one commit.
3. A native step's journal append and its folds commit in one machine unit, as today (section 2 §2.4.6).
4. `set_thread_model` changes a thread's model through `model_preference`, and a refused switch is refused by the write door, not the resolver (claim [[cf415ff4]]).
5. `ThreadExecution` is declared here and bound at `start` to invocation's implementation: a native run reaches `tools`, `execute` and `afterEdit` only through it, and `afterEdit` runs the edit check through enforcement as today. `compact` and `refresh_thread_instructions` refuse `external-context` for a thread whose harness is external, and the workspace-source reload answers `workspaceInventorySchema` as today.

**12. Risks.**
- **The largest harness move.** `ThreadStore`, `ThreadRunStore` and `ThreadEntryFold` are on every turn's path. The splits of M2 keep each statement byte-identical; the routing through threads and thread-record lands at M3 one owner at a time, with the native suites and the conformance suite run whole after each.
- **Maintenance passes write threads' table.** They go through threads' journal service as a participant; if that service is not ready at this wave's M1, they keep their direct writes as an owned exception named in the wave report, ending at M3.
- **Evidence cursors are signed per process.** A restart invalidates them today and after; no new persistence is introduced.

### 7.5.22 `external-harnesses`

**M1 delta review, branch `46a1863bec` against frozen `98d8d3a216`.** Of 78 mapped/received source paths, 41 changed and four were deleted. `harness/capturedHooks.ts` already moved to `composition/testing/capturedHooks.ts`; `protocol/numbers.ts#CURSOR_SESSION_START_CHARS` already sits beside its reader in `protocol/harness/hookFormat.ts`. `harness/ThreadTitleStore.ts` dissolved into `thread-record` and the external binding check now stands at `external-harnesses/titles.ts#adoptSessionTitle`; `operations/measure.ts#read_installation_status` moved to `operations/installStatus.ts`, while its declaration remains a legacy row in `protocol/operations/graph.ts`. D4 already created `external-harnesses/store/tables.ts`, `external-harnesses/session.ts` and `external-harnesses/rollout.ts`, and switched `HarnessSessionStore` to the `external_session` row and `ThreadRecords.publishStatus`; reuse its migrated row, do not run D4 again. The relocated `composition/testing/capturedHooks.ts` now imports `CORPUS_ROOT` rather than a relative product path, but still has no caller-supplied corpus directory as §8 specifies; its composition owner must complete that target before [[29682eb9]] is reconciled. These are intermediate current paths, not replacements for the targets in §8.

**Importer delta.** New `external-harnesses/store/tables.ts`, `session.ts`, `titles.ts`, `rollout.ts` and test files consume the old `protocol/harnesses.ts`/`harnessObservation.ts` contracts; `ThreadStore.ts` and `HarnessSessionStore.ts` now consume the new session rows. `protocol/harness/table.ts#sessionIdentity` and `#sessionIdentityLayer` gained 26 importers, including runtime and test fixtures; two new composition files import `skill/mcpDeclaration.ts#installMcpDeclarations`. A current-path `SessionAdoption` tag replaced the old `HarnessAdoptionOwner`, but the target remains the amendment's `HarnessAdoption` tag and private `SessionAdopter`. M2 recensus must include these edges and the then-current importer table; non-literal dynamic imports remain unjudged.

**1. Ownership.** External agent CLIs run as threads of Tagma: one adapter per CLI, their launch, hooks, sessions, observations, typing, permissions, reports and what Tagma installs into them (section 1 §1.3, new). Directory `external-harnesses/`. Glossary words owned: **external session** (← the harness facet, section 5 "facet" retired), **adapter** (a vendor row), **vendor**, **hook** (a CLI's event call into Tagma), **observation**, **adoption** (a CLI started in a Tagma shell taken as a thread), **screen ask**, **install** (skill, hooks, law, MCP declaration written into a CLI's places). "Harness" is reserved to `threads`, native-harness and this module (S7 (b)).

**2. Wave.** W6, level 11. Its **W2a store step** creates `external-harnesses/store/tables.ts` for `external_session`, which D4 fills from the rows with `thread.harness IS NOT NULL` (229 of 3,840 on this machine, read 2026-09-27 — a sample), carrying the facet structurally whole and the legacy-run facts (section 1 §1.13 (c)–(g)). The wave opens after threads M1; runs beside `native-harness`. Carries the external `Harness` implementation, the title adoption's binding check (7.5.5), the terminal-adopter hook contribution (executions), the setup-step contribution (installation), the gauge contribution (graph's hook ledger), the move of the hook transport out of the `cli` door (section 1 problem 5), per-vendor directories, and K2 for the harness routes.

**3. Offers.**
- `contract/wire/` — `session.ts` (← `protocol/harnessSession.ts`: launch storage, the session row, the standing ask, liveness); `externalSession.ts` (← `protocol/harnesses.ts`: `HarnessInstall`, `ExternalSession` ← `HarnessFacet`, `externalSessionSchema` ← `harnessFacetSchema`, `parseExternalSession` ← `parseHarnessFacet` with the legacy migration, the row detail `HarnessRowDetail` ← `ThreadHarness`, `HarnessRowEnding` ← `ThreadHarnessEnding`); `observation.ts`; `answer.ts`; `adoption.ts`; `call.ts`; `askedModel.ts`; `operations.ts` (`speak_harness`, `read_harness_screen`, `read_installation_status`, and the hook road's operations of 7).
- `contract/service/` — `adapter.ts` (← `protocol/harness/adapter.ts`: `HarnessAdapter` and its surfaces), `table.ts` (`HARNESSES`, dispatch by name), `harness.ts` (the external `Harness` implementation), `sessions.ts` (`HarnessSessions`), `adoption.ts` (`HarnessAdoption` ← `HarnessAdoptionOwner`), `installs.ts` (install, refresh, status).
- **Contributions:** `Harness` (threads; its record part is `external_session` and the legacy-run facts); agent library entries (the `harness:<vendor>` spawn types) and row detail (threads); terminal adopters (executions); the setup step installing into the machine's CLIs (installation); the hook-ledger gauge (graph); the title adoption (thread-record's `adoptTitle`, called after this module checks its own binding).
- **Keys:** `threads.harnessTitle`, the installed-CLI, hook and launch keys.

**4. Needs.** `platform` (units, `HarnessId`, `SessionRef`); `projects`; `settings`; `providers` (the model a CLI is launched on); `thread-record` (participant: phase and adopted title); `workspace` (roots for launch and adoption, bindings of reported files); `graph` (the touch brief within a hook budget); `change-record` (record a CLI's reported writes); `power` (work counts); `executions` (pty launch, keys, screen; terminal adopters); `installation` (the installed `tagma` binary; the setup hook); `threads` (implements `Harness`; journal, catalog, inbox, birth, library, doctrine). **No import of native-harness** (today 11 sites reach native internals — the kernel thread-store adapter, rollout, the kernel state type — all through threads' ports after this wave).

**5. Tables.** `external_session` (new, D4: the facet whole — held answers, question, session, observation, retiring — plus `updated_at` and the native selections kept for the seven rows that carry them, named in a finding); the legacy-run facts as part of that record, keyed by the old run id. It no longer writes `thread` or `thread_run` (today `HarnessSessionStore.ts`).

**6. Lanes, resources, passes.** One typing lane per session; drive fibers per session; metadata jobs per thread with a cadence and a shared command cache; screen-ask watchers; the attending set and its working-count hook to power. Passes (rule [[a00f91b0]]): recovery and reconcile of uncertain sessions at boot, held-answer expiry, install refresh after a deploy (through installation's succession, as the setup hook).

**7. Operations.** `speak_harness`, `read_harness_screen`, `read_installation_status` (from graph, 7.5.7). The hook road's typed routes (K2) become operations the hook door calls: `POST /api/harness/report` → `report_harness_event`, `/answer` → `answer_harness_turn`, `/permission` → `judge_harness_call`, `/permission/outcome` → `record_harness_outcome`, `/stop` → `stop_harness_turn`, `/acknowledge` → `acknowledge_harness_delivery`, `/adopt` → `adopt_harness_session` (new names, section 5 grammar, reviewed before the wave opens). `answer_ask` and `cancel_ask` are threads' (dispatching here through `Harness`). CLI verbs: `hook`, `review`; the `harness` verb's turn acts go to threads (8 (d)).

**8. Target file map.**

*(a) Files whose primary owner is `external-harnesses`* (71 files, 11,668 lines). Paths relative to `external-harnesses/`.

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `harness/HarnessSessions.ts` | 922 | split (F2, F4 gate): `sessions/drive.ts` (L50–278, L394–551: gates, start, adopt, send, receive, typing, the launched and adopted drives); `sessions/lifecycle.ts` (L280–392, L553–728: stop, retire, recover, attend, foreground, quit, reconcile, exit); `sessions/roots.ts` (L730–922: root preparation, witness, held release, finish, report) | `HarnessSessions` stays the boundary name |
| `harness/HarnessObservations.ts` | 784 | split (F2, F4 gate): `observations/admission.ts` (L45–350); `observations/binding.ts` (L352–486: metadata compare-and-set, witness binding, title adoption); `observations/work.ts` (L488–784) | — |
| `harness/HarnessSessionStore.ts` | 198 | `store/sessions.ts` | writes `external_session`; phase through `ThreadRecords.publishPhase` in the same unit |
| `harness/HarnessAdoption.ts`, `shellJob.ts` | 217 | `adoption/adopt.ts`, `adoption/shellJob.ts` | `HarnessAdoptionOwner` → tag `HarnessAdoption` |
| `harness/HarnessBirths.ts`, `harnessFacet.ts`, `harnessTypes.ts`, `installedHarnesses.ts` | 284 | `birth/sessionBirths.ts` (F1: `birth/births.ts` would be named after its directory), `birth/session.ts`, `birth/types.ts`, `birth/installed.ts` | `harnessAtBirth` → `sessionAtBirth`; births go through threads' birth with `Harness.born` |
| `harness/HarnessDeliveries.ts`, `HarnessReports.ts` | 326 | `turns/deliveries.ts`, `turns/reports.ts` | — |
| `harness/HarnessLanes.ts`, `harnessKeyboard.ts`, `harnessLaunch.ts`, `harnessFailure.ts` | 742 | `sessions/lanes.ts`, `sessions/keyboard.ts`, `sessions/launch.ts`, `sessions/failure.ts` | F2 cleared; keyboard F4 watch |
| `harness/HarnessPermissions.ts`, `HarnessScreenAsks.ts` | 564 | `asks/permissions.ts`, `asks/screen.ts` | — |
| `harness/HarnessMetadata.ts`, `harness/metadata/MetadataCommands.ts`, `MetadataFile.ts`, `MetadataIndex.ts`, `MetadataRuntime.ts`, `fields.ts`, `policy.ts`, `sources.ts`, `table.ts`, `words.ts`, `rootArtifact.ts` | 1,040 | `metadata/jobs.ts`, `metadata/commands.ts`, `metadata/file.ts`, `metadata/sessionIndex.ts`, `metadata/runtime.ts`, `metadata/fields.ts`, `metadata/policy.ts`, `metadata/sources.ts`, `metadata/table.ts`, `metadata/words.ts`, `metadata/rootArtifact.ts` | F2 cleared; no file is named `index.ts` (rule 8183e6ef) |
| `harness/metadata/claude.ts`, `codex.ts`, `cursor.ts`, `devin.ts`, `grok.ts` | 228 | `vendors/<vendor>/metadata.ts` | per-vendor directories |
| `protocol/harness/claude.ts`, `codex.ts`, `cursor.ts`, `devin.ts`, `gemini.ts`, `grok.ts` | 875 | `vendors/<vendor>/row.ts` | clears task [[c9154a67]] (six adapter files claimed by seven areas): each vendor directory is one area |
| `protocol/harness/adapter.ts`, `table.ts`, `names.ts`, `payload.ts`, `claudeFormat.ts`, `hookFormat.ts`, `screenAsk.ts`, `call.ts`, `askedModel.ts` | 800 | `contract/service/adapter.ts`, `contract/service/table.ts`, `contract/wire/names.ts`, `adapter/payload.ts`, `adapter/claudeFormat.ts`, `adapter/hookFormat.ts`, `adapter/screenAsk.ts`, `contract/wire/call.ts`, `contract/wire/askedModel.ts` | `hookFormat`'s `contextPricing`, `promptAnswerChars` are handed to graph's orientation as the hook budget argument |
| `protocol/harnessSession.ts`, `harnessObservation.ts`, `harnessAnswer.ts`, `harnessAdoption.ts` | — | `contract/wire/session.ts`, `observation.ts`, `answer.ts`, `adoption.ts` | renames in 3 (S2, S7) |
| `protocol/harnesses.ts` | — | `contract/wire/externalSession.ts` | renames in 3; `HarnessId` → **`platform`** `contract/wire/session.ts` (a brand without a list, 7.5.1) |
| `harness/prepareRoot.ts`, `readWitness.ts` | 256 | `sessions/prepareRoot.ts`, `sessions/readWitness.ts` | section 1: root preparation and the read witness come here from [[12972a3b]] |
| `cli/hooks.ts` | 821 | split (F4 gate): `hooks/events.ts` (L34–94); `hooks/touchState.ts` (L96–228); `hooks/session.ts` (L231–380: start, report, first prompt); `hooks/writes.ts` (L382–586: base shadowing, pending flush, tool-use hooks); `hooks/permission.ts` (L588–629); `hooks/stop.ts` (L644–748: turn end, doctor); `cli/hook.ts` (L750–821: the verb) | the hook door calls the operations of 7 through platform's verb contract |
| `cli/hookAdoption.ts`, `cli/hookDelivery.ts` | 233 | `hooks/adoption.ts`, `hooks/delivery.ts` | — |
| `cli/commands/review.ts`, `cli/reviewLaunch.ts` | 239 | `cli/review.ts`, `review/launch.ts` | `REVIEW_HARNESSES`, `harnessHere` kept |
| `skill/install.ts` | 648 | split (F4 gate): `installs/targets.ts` (L74–120); `installs/hookInstall.ts` (L122–267, L362–430); `installs/refresh.ts` (L291–343); `installs/skill.ts` (L432–504); `installs/status.ts` (L514–608); `installs/law.ts` (L610–638) | the skill body is rendered from threads' doctrine at install time |
| `skill/mcpDeclaration.ts`, `skill/upgrade.ts`, `skill/hookLedger.ts` | 634 | `installs/mcpDeclaration.ts`, `installs/upgrade.ts` (the setup step installation calls), `installs/hookLedger.ts` (the gauge contribution) | — |
| `operations/harness.ts`, `protocol/operations/harness.ts` | 182 | `operations.ts`, `contract/wire/operations.ts` — `speak_harness`, `read_harness_screen`; `answer_ask`, `cancel_ask` → threads | `HARNESS_OPERATIONS` keeps its name (reserved word in its own region) |
| `harness/askEditorProgram.ts`, `askWidgetProgram.ts`, `keyboardFixture.ts` | 602 | `testing/askEditor.ts`, `testing/askWidget.ts`, `testing/keyboard.ts` | this module's own doubles |
| `harness/capturedHooks.ts` | 54 | **composition's test world** (`composition/testing/capturedHooks.ts`), with the corpus location **passed in** (section 6 §6.2.3, §6.8) | today it reads `packages/llm/src/capture/records/` by a relative product path (L5) and imports `@runlith/llm/capture/record`; the test world receives the corpus directory from its caller, and no module's `testing/` imports a corpus by path (claim [[29682eb9]] re-anchored there) |
| `cli/commands/harness.ts` | 548 | → **threads** `cli/turns.ts` (territory correction, §7.6) | its verbs ask, reply, stop, continue, steer, compact and unqueue **native** threads and follow their feed; they are thread turns, dispatched through `Harness` |

*(b) Parts received:* from `ThreadActs.ts` (threads) the speech and screen acts (L559–630) and the report and answer acts (L730–847) → `turns/speech.ts`, `turns/answers.ts`; from `ThreadStore.ts` (native-harness) `placedIn`, `adoptedOn`, `adoptedIn` and the facet parts → `store/sessions.ts`; from `ThreadTitleStore.ts` (7.5.5) the facet binding check → `observations/binding.ts`; `read_installation_status`: its declaration (from `protocol/operations/graph.ts`, graph) → `contract/wire/operations.ts`, its body (`operations/measure.ts` L186–204, graph) → `installs/status.ts`, the install-state and hook-ledger shapes (graph's reports) → `contract/wire/installs.ts`; the body reads graph's served tree for its `conflicts` field over the registry's `external-harnesses → graph` relation; `harnessTitle` (settings); the vendor session prefix and identity variables stay platform's arguments (7.5.1).

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `protocol/session.ts` (platform, 7.5.1): the vendor lookup in `HARNESSES` that `sessionName` did → `vendors/sessionPrefix.ts`, handed to platform's `sessionName` as its prefix argument
- from `protocol/numbers.ts` (platform, 7.5.1): `CURSOR_SESSION_START_CHARS` → beside its one reader, in the file of this card's (a) that reads it

*(c) Symbols renamed:* `HarnessFacet` → `ExternalSession`, `harnessFacetSchema` → `externalSessionSchema`, `parseHarnessFacet` → `parseExternalSession`, `harnessAtBirth` → `sessionAtBirth` (S7 "facet"); `ThreadHarness` → `HarnessRowDetail`, `ThreadHarnessEnding` → `HarnessRowEnding`, `threadHarness*Schema` → `harnessRow*Schema` (S2); `HarnessAdoptionOwner` → `HarnessAdoption`. Frozen: the facet's JSON shape inside `external_session` (carried whole), vendor names, hook event keys and answer spellings, `TAGMA_*` launch variables, installed file names and markers, the review harness list.

*(d) Leaves:* `cli/commands/harness.ts` → threads; `answer_ask`, `cancel_ask` → threads.

**9. Debt retired.** `modules`: `external-harnesses → cli` (18) by platform's verb contract and the hook transport moving here; the native internals it reaches today go through threads' ports. Edges into it cut by other cards: `threads → external-harnesses` (34), `native-harness → external-harnesses` (10), `graph → external-harnesses` (5), `thread-record → external-harnesses` (3), `executions → external-harnesses` (1), `installation → external-harnesses` (3). `names`: F4 gate — `HarnessSessions.ts` (922), `cli/hooks.ts` (821), `HarnessObservations.ts` (784), `skill/install.ts` (648); F2 — the 20 `Harness*`/`harness*`/`Metadata*` files; S2 — `ThreadHarness*`; S3 — `HarnessAdoptionOwner`; S7 — the three facet names.

**10. Graph work.** The zone [[6ca6b465]] "A foreign CLI run as a thread of Tagma" becomes `#module` `external-harnesses` (`dir` `apps/tagma/server/src/external-harnesses`, `depends-on` per 4), renamed to the glossary's word ("external"), with areas per concept of 8 and one area per vendor directory; [[62c4c0fc]], [[84e4f537]], [[b981c47a]], [[4a45ae5b]], [[b318fc25]], [[b8d7f55c]], [[79d2a545]], [[6e948fd9]] re-hang by meaning; [[12972a3b]]'s root preparation and read witness come here. Claims whose titles say "foreign" are rewritten at M3 (S7 (a) retired spelling). Tasks kept: [[3b56f6f5]], [[1fe78496]], [[08c2587f]]; [[c9154a67]] closes with the vendor directories.

**11. Acceptance.**
1. `external-harnesses/` imports no native-harness file; zero `modules` and `names` debt; `cli/hooks.ts`, `skill/` and `protocol/harness/` are gone.
2. The external `Harness` passes threads' conformance suite; an external session's phase and `external_session` row change in one commit.
3. After D4, every external thread's facet reads back byte-equal from `external_session`, and its legacy runs read as facts; a lost store is rebuilt from the rollout's `{thread, facet, session}` line as today.
4. `adopt_thread_title` adopts only for a root whose binding matches, checked here, written by thread-record in one unit.
5. The hook door answers each vendor's hooks within its budget, as today, through the new operations.

**12. Risks.**
- **D4 carries the facet whole.** No field is reinterpreted in this wave; a narrower `external_session` codec would be a later, separate change (section 1 §1.13 (c)).
- **The hook door runs in the CLI's process** under a tight budget; moving it out of `cli/` must not add a server round trip per hook. The builder keeps the calls one per hook, as today, and measures the hook time on the capture corpus before and after.
- **`cli/commands/harness.ts` changes owner and module.** The `tagma harness` verb's spelling stays for one release as an alias of the threads verb (section 4's alias rule), so operator scripts do not break.

### 7.5.23 `invocation`

**1. Ownership.** Running one call: admission, the call's services (its lifetimes), the permission verdict, triggers, deadlines, execution, and the native tool door (section 1 §1.3). Directory `invocation/`. Glossary words owned: **admission**, **call** (one operation invocation), **lifetime** (call, run, workspace, installation — section 5 A4), **verdict**, **trigger** (a before or after rule check around an operation), **call key** (`{actorRef, operation, key}`), **request key**, **door** (as the port every surface calls through).

**2. Wave.** W7, level 12. Opens after native-harness and external-harnesses M1. **K5a** lands earlier, in this module's current code, at W1 (§7.2.3: `read_operations`, `Tagma-Contract`, `Tagma-Outcome`, aliases and tombstones, answer versions — before the first typed route retires). The wave itself carries **K1** (one admission including the origin; per-call lens, origin, file scope, provenance and verdict; the verdict protocol at every door; call keys and carriers — `requestKey` ← `operationId` through `renamed` for one release; `manual` settle reads; the deadline table; the unified refusal shape; `no-ambient-capability` at gate), `ScopeServices` → `LifetimeServices` (section 5 A4), and `Actor.session` (already renamed in W0). The doors open at its M1.

**3. Offers.**
- `contract/service/` — `admission.ts` (`admit(request) → Call`: actor from grant, session token, shell key or act header; project; lens and served graph through graph; working place through workspace; file scope; the verdict), `call.ts` (`Call`, `LifetimeServices`, the call key), `perform.ts` (`perform(call, operationId, input)` with triggers, deadlines and answer shaping; `performById`), `nativeDoor.ts` (**invocation's implementation of native-harness's `ThreadExecution` port**: the per-caller tool catalog `tools`, `execute` under the run's own grant, the `afterEdit` ingress), `refusals.ts` (the unified refusal shape and the HTTP status by class; with `perf E5`, the door-level code `act-spent` for every keyed write whose act happened and whose result is no longer kept — accepted [[9c085c6c]] §3.13.15's amendment to section 4 §4.4.5; the ledger's door phases, §3.13.10).
- `contract/wire/operations.ts` — `read_operations` (K5a).
- **Port it implements:** native-harness' `ThreadExecution` (declared there, consumed by the native run; bound by `composition` at `start`). **Service it calls:** external-harnesses' session resolution (a token or shell key → an adopted session or an external principal).
- **Manifest:** its operation; no CLI verb (`tagma op` and `mcp-serve` are the `cli` door's, reading the catalog through `read_operations`).

**4. Needs.** `platform` (declaration machinery, `Credential`, `Actor`, `ActorRef`, the call key, the trigger shape); `projects` (the project of a call); `thread-record` (grant → thread); `workspace` (the working place); `graph` (lens, served graph); `threads` (standing permission rules, thread audience); `native-harness` (the `ThreadExecution` port it implements — an import of native-harness's contract, the registry's `invocation → native-harness` relation; an act header → the run and its state); `external-harnesses` (session token or shell key → adopted session or external principal). Enforcement's `RuleChecks` port is reached through the trigger shape: each trigger site asks it (7.5.15).

**5. Tables.** None. **6. Lanes, resources, passes.** The deadline table (section 4); per-caller tool builders (a weak map today, per call's lifetime after); no pass. **7. Operations.** `read_operations` (K5a). No typed route.

**8. Target file map.**

*(a) Files whose primary owner is `invocation`* (4 files, 518 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `operations/perform.ts` | 98 | `invocation/perform.ts` | the rule-check triggers call enforcement's port; the terminal actor projection is `ActorRef` |
| `operations/nativeTools.ts` | 275 | `invocation/nativeDoor.ts` | the catalog is the manifests' (K3), handed in by composition; the journal settle reads graph's `journal/callRange.ts` (7.5.7) |
| `operations/nativeOwners.ts` | 117 | **dissolves** into the lifetime contributions: each module contributes its services to the call's lifetime in its manifest (change-record's log ports, sandbox's guest imports, executions' terminals and commands, workspace's checkout acts, mcp's servers, performance's stores) | `nativeOwners`, `OperationOwners` retire (S3 signal); `CHECKOUT_DIRECTORY` → graph's `GRAPH_DIRECTORY` (invocation → graph is a registry relation); `CheckoutActOwner`, `McpServers` read from their owners' contracts |
| `operations/failures.ts` | 28 | `invocation/refusals.ts` | the terminal-failure projection is executions' voice |

*(b) Parts received:* from `http/caller.ts` (http) the identity proofs (L42–195: `grantedThread`, `adoptedThread`, `signedBy`, `actOf`, `identityOf`), project resolution and lens (L197–301), admission (L303–339) and the project and operation caller assembly (L341–427) → `invocation/admission/*` — the header parsing stays with each door; from `http/operationBinding.ts` (http) the owner contexts and typed performers → `invocation/perform.ts` (`HttpOwners`, `HttpOperationOwnerContext`, `HttpOperationFileOwners` → the call's lifetime services); from `http/handlers/answering.ts` (http) the refusal shaping and server-fault capture → `invocation/refusals.ts`; from `api/Caller.ts` (http) `CallerContext`, `HttpOperationCaller` → `contract/service/call.ts` as `Call`.

*(c) Symbols renamed:* `ScopeServices` → `LifetimeServices`; `operationId` field → `requestKey` (with `renamed`); `CallerContext`, `HttpOperationCaller` → `Call`; `nativeOwners`, `OperationOwners` retire. *(d) Leaves:* nothing.

**9. Debt retired.** `modules`: `invocation → executions` (`nativeOwners`, appendix B: "`invocation → executions` through `nativeOwners`") by the lifetime contributions; the capability sites naming other modules' operations by the manifests. The 47 door edges (`http`, `socket`, `cli` → domain modules) are the doors' to cut against this module's contract. `names`: none at gate.

**10. Graph work.** New `#module` `invocation` (`dir` `apps/tagma/server/src/invocation`, `depends-on` per 4). It takes the admission and verdict claims of [[e2262db0]] / [[0075ecae]] ("What it takes to answer a request") and the call presentation of [[89df5e7a]] (section 1 §1.13's §8.7 row); [[3dbd3b23]] "What an operation actually does" keeps its operation-body claims with each owner and its perform and trigger claims here.

**11. Acceptance.** Every door calls `invocation` and nothing else of the domain (section 1 rule 5, `modules` measures it); one admission answers the same actor, project, lens, origin and verdict for the same request at every door; an ended run's act header gives provenance and a thread actor and no run scope; `no-ambient-capability` stands at gate with zero debt.

**12. Risks.** K1 changes every door at once. The wave lands admission behind today's per-door code first (both answering, compared in tests), then switches each door, one per change.

### 7.5.24 `http`

**1. Ownership.** The HTTP door: parsing requests, calling `invocation`, answering, and serving the app, artifact pages and the health probe (section 1 §1.3). Directory `http/` (kept). Glossary word owned: none beyond **door** in its HTTP sense.

**2. Wave.** W7, level 13. Opens after invocation M1; runs beside `socket`, `cli`, `composition`. Carries K2's remaining routes (every module moved its routes in its own wave; this wave removes the typed route groups one release after their last caller moved, answering 410 for one more), the generated `/api/op/<id>` endpoints and client, and the door edges' cut.

**3. Offers.** The door layer: `door.ts` (assembly, request logging, unknown-path answer, the global middleware), the generated operation endpoint, `health.ts` (the liveness probe), `artifacts.ts` (page serving under its content-security policy), `schemaRefusal.ts`, `callLog.ts`. Nothing is imported from it by a domain module.

**4. Needs.** `platform` (wire codecs, failure classes) and `invocation`'s `contract/service` only (section 1 rule 5).

**5. Tables.** None (`http/caller.ts` reads `thread`, `thread_run`, `terminal` today: those reads leave with the admission). **6.** No lane; the door's request log. **7. Operations.** None of its own.

**8. Target file map.** *(a) Files whose primary owner is `http`* (84 files, 8,988 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `api/*.ts` (45 route groups and `Api.ts`, `CallLog.ts`, `Caller.ts`, `SchemaRefusal.ts`) | 3,016 | **retire** group by group through K2, each in its owner's wave (the K2 tables of the cards above name every route's operation), and a route retires only after its operation, K5a's alias and answer version, and the app's generated route stand in the same build; binary routes (thread upload and attachment, 7.5.20) and checkout picture (`GET /api/checkouts/:rootId/picture`, 7.5.6) stay HTTP resources with their current URLs and headers; `Api.ts` shrinks to the generated group and the health, artifact and retained binary routes; `api/checkouts.ts` keeps only its picture GET while its other routes retire through K2; `CallLog.ts`, `SchemaRefusal.ts` → `http/callLog.ts`, `http/schemaRefusal.ts`; `Caller.ts` → invocation (7.5.23 (b)) | `Artifact` → artifacts' `ArtifactRow` |
| `http/handlers/*.ts` (32 handlers) | 4,500 | **retire** with their groups; parts that hold domain logic move to the owner first: `auth.ts` sign-in flows → providers (7.5.4), its permission-rule endpoints → threads; `accounts.ts`' cache-lifetime blending and `credentialRefusal.ts` → providers; `files.ts` → graph (log, resolve, sync), workspace (exists), change-record (strip); `documents.ts` → graph; `handlers.ts` (the composition of owners) → composition; `answering.ts` → invocation; `operations.ts` (the generic perform endpoint) stays as `http/operations.ts`; `checkouts.ts` retains only the picture GET with `HttpServerResponse.uint8Array`, its MIME, cache policy and `nosniff`, calling workspace's `checkouts/picture.ts` (B1); the other checkout routes retire through K2 | `handlers.ts` F1 ends with its retirement |
| `http/caller.ts` | 480 | split: the header reading and the middleware layer (L429–480) stay as `http/caller.ts`; everything else → invocation | — |
| `http/operationBinding.ts` | 138 | → invocation | — |
| `api/database.ts` (10) | — | **retires** in installation's wave with `vacuum_database`'s generated endpoint; its `vacuumSchema` import is installation's wire (7.5.9) | — |
| `http/handlers/database.ts` (17), `gauges.ts` (86), `performance.ts` (32), `projects.ts` (116) | — | **retire** with their groups, nothing moved first: author-read, each `handle` performs an operation or calls one owner's read — `database` → `vacuum_database` (installation); `gauges`' seven routes → the graph operations of 7.5.7's `api/gauges.ts` row; `performance`' three → 7.5.16's; `projects`' `list`, `current`, `add`, `byRef`, `setRoot`, `remove` → 7.5.2's operations and `setSetting`, `setStorage`, `branches`, `roots` → graph's (7.5.2's table) | — |
| `http/door.ts`, `artifacts.ts`, `callLog.ts`, `schemaRefusal.ts` | 267 | kept | `measureNotice` reads graph through invocation's call, not `CallerCheckout` directly |
| `http/wire.ts` | 23 | → **`graph`** `voice/written.ts` (block writes, batch outcomes) | — |

*(b) Parts received:* from `protocol/numbers.ts` (platform, 7.5.1): `PALETTE_PAGE_SIZE` → the generated palette route's file. *(c) Symbols renamed:* none of note (S5 `*Handler` stays allowed in doors). *(d) Leaves:* as above.

**9. Debt retired.** The door edges `http → <module>` (section 1 appendix B's 47 door edges, shared with socket and cli) by K1 and K2; `http/handlers/handlers.ts` F1.

**10. Graph work.** [[e2262db0]] "The doors this server answers at" becomes the zone of `#module` `http` (`depends-on` `invocation`), with the socket and CLI doors as sibling modules; its admission claims go to invocation; task [[f2781507]] closes into the zones written.

**11. Acceptance.** `http/` imports only `platform` and `invocation`'s contract; every retired route answers 410 for one release; the app and CLI call only generated endpoints.

**12. Risks.** The app is same-build; external scripts calling typed routes get the 410 window. The builder lists every typed route with its operation and retirement release in the wave report.

### 7.5.25 `socket`

**1. Ownership.** The live socket door: subscriptions to feeds and live acts over one websocket RPC, calling `invocation` (section 1 §1.3). Directory `socket/` (kept).

**2. Wave.** W7, level 13. Opens after invocation M1. Carries **K3**'s feeds (each module declares its feeds in its manifest; the socket serves them generically) and K2's rule that socket act verbs become operations.

**3. Offers.** `live.ts` (the RPC layer over websocket, the call log, socket open and close observation), `rpc.ts` (generic `subscribe(feed, params)` and `perform` RPCs; `TAGMA_SOCKET_PATH` stays an external name).

**4. Needs.** `platform`, `invocation`. **5.** No tables. **6.** A per-connection generation counter; view leases are executions'. **7.** No operations of its own.

**8. Target file map.** *(a)* (13 files, 1,410 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `socket/live.ts`, `socket/rpc.ts` | 459 | kept; `rpc.ts` loses the per-feed and per-verb declarations and is generated from the manifests, after every owner has registered its feeds and act operations (§7.2.2 rule 11): the thread act verbs become the operations of 7.5.20's act table (review D2); the three feeds `live.ts` serves directly (L80–82, declared `rpc.ts` L112–126) get owners that declare and register them in their manifests with today's names and schemas (review D1) — `accounts.subscribe` (`accountsFrameSchema`) → **providers**, `awake.subscribe` (`awakeStandingSchema`) → **power**, `pace.subscribe` (`paceStandingSchema`) → **executions**; terminal input and grid acts become executions' operations | the `continue_thread` annotation derives from the manifest |
| `socket/graphChannel.ts` | 24 | → **`graph`**: the graph feed (`journal/feed.ts`, declared in graph's manifest) | — |
| `socket/threadChannel.ts` | 236 | → **`threads`**: its feeds (list, thread with resume and replay) and operations; the warmth basis → **`native-harness`** | `ThreadChannelOwners` retires |
| `socket/terminalChannel.ts`, `commandBytesChannel.ts`, `commandChannel.ts` | 457 | → **`executions`**: its feeds (screen, bytes, receipts, grid, command feed) with their view leases and input lanes | — |
| `socket/checkoutChannel.ts` | 28 | → **`workspace`**: its checkout feed | — |
| `socket/changesChannel.ts` | 40 | → **`change-record`**: its changes feed | — |
| `socket/worktreeChannel.ts` | 18 | → **`worktrees`**: its worktree feed | — |
| `socket/callChannel.ts` | 20 | → **`native-harness`**: its calls feed | — |
| `socket/pageWorld.ts`, `pageWorldServer.ts` | 115 | composition's test world | — |

*(c)* none. **9. Debt retired.** Door edges `socket → <module>` (e.g. `socket → projects` 8). **10. Graph work.** `#module` `socket` (`depends-on` `invocation`) beside `http`; the channel claims move to each feed's owner. **11. Acceptance.** Every feed the app subscribes to is declared in its owner's manifest and served by the generic RPC; `socket/` imports only `platform` and `invocation`. **12. Risks.** The terminal channel's lane turns are latency-bound; moving them into executions keeps the per-lane serialization in one place and adds no hop.

### 7.5.26 `cli`

**1. Ownership.** The `tagma` command-line door: parsing argv, running verbs each module declares, calling the server, printing (section 1 §1.3, §1.6.3). Directory `cli/` (kept). It owns no domain verb: `op`, `mcp-serve` (with composition) and the listing verbs `edges`, `sessions` only.

**2. Wave.** W7, level 13. Opens after invocation M1. Carries K5a's consumers (`tagma op` and `mcp-serve` read the server's catalog through `read_operations`), the verb contract already in platform (W0), and the move of every domain verb to its owner's `cli.ts` (done in the owners' waves).

**3. Offers.** `invoke.ts` (`invoke(argv, verbs) → exit code`: the door; the process entry that binds `process.argv` and `process.exit` is composition's `entries/cli.ts`, from today's `cli/main.ts`), `verbs.ts` (verb names → owners' `cli.ts`, derived from the manifests), `door.ts` (the HTTP client, signing, caches), `live.ts`, `exit.ts`, `help.ts`, `args.ts`, `invocation.ts` (`Invocation`, `CurrentInvocation`), `serverStart.ts`.

**4. Needs.** `platform`, `invocation`'s contract (for signing and the call key); verbs arrive from each module's `cli.ts` (a manifest contribution, section 4).

**5–7.** No tables, no lanes, no operations.

**8. Target file map.** *(a)* (16 files, 1,355 lines): `cli/args.ts`, `door.ts`, `exit.ts`, `help.ts`, `invocation.ts`, `invoke.ts`, `live.ts`, `serverStart.ts`, `verbs.ts` kept (the verb contract parts — `verb()`, args, help, exit class, operator output — are platform's since W0, 7.5.1); `cli/commands/op.ts`, `cli/commands/mcpServe.ts`, `cli/commands/reads.ts` → `cli/verbs/op.ts`, `cli/verbs/mcpServe.ts`, `cli/verbs/reads.ts`; `operations/mcpTools.ts` → `cli/mcpTools.ts` (the catalog served as MCP tools); `cli/operatorOutput.ts` (247) → dissolves: `print`, `write`, `rowText` stay (`cli/print.ts`), the domain renderers go to their owners (`renderStanding`, `renderStatus`, `renderBuilds` → installation; `renderHooksWrite`, `renderMcpWrite`, `renderInstallResult`, `renderUserInstallResult`, `renderUpgradeResult` → external-harnesses; `renderEdges` → graph; `renderProjects` → projects; `renderAuth` → providers — 7.9); `cli/captured.ts`, `cli/fixtureHome.ts` → composition's test world.

*(b)* the domain verbs arrive only as manifest contributions. *(c)* none. **9. Debt retired.** The `X → cli` edges of every module (graph 8, executions 7, installation 15, threads 9, external-harnesses 18, and the rest) are retired in the owners' waves by platform's verb contract; this wave retires `cli → <module>` door edges. **10. Graph work.** The area [[03de79f4]] "The `tagma` command line" becomes `#module` `cli` (`depends-on` `invocation`); claim [[7750f179]] (the CLI reads its environment from the `Invocation`) stays here; [[4c684fe0]]'s install claims went to external-harnesses and installation. **Amendment needed to section 1 (not made by this card):** §1.3 gives the process entry points to `composition`, while §1.6.3 calls the CLI process the `cli` door's. By responsibility: the process entry (reading `process.argv`, binding `process.exit`, handing the manifest) is composition's, because only composition may import every module's verbs; the door (argv parsing, verbs, printing, exit classes) is cli's. §1.6.3 should read "the CLI door", not "the CLI process". **11. Acceptance.** `cli/` imports only `platform` and `invocation`, and has no process entry; `tagma op` lists the server's catalog; every verb of section 1 §1.6.3 runs from its owner's `cli.ts`. **12. Risks.** The CLI runs without a server for `execution-host` (claim [[bd6ce719]]); lazy verb loading must keep that verb's imports free of the door client.

### 7.5.27 `composition`

**1. Ownership.** Assembling the modules: their layers, manifests, arguments and start bindings, and the process entry points (section 1 §1.3). Directory `composition/`. Glossary words owned: **manifest** (the union of contributions), **start** (the two-phase binding), **test world** (fixtures that assemble several modules, section 6).

**2. Wave.** `composition start` runs after platform M1 and before projects M1: it creates `composition/start.ts` and connects it from the old runtime before admission, so every subsequent early M1 has an actual binding point (§7.2.7). W7 `composition M1` opens after every other module's M1 (it imports all of them) and only dissolves the old assembly after those implementations exist; `composition M2` waits for their M2 and then removes the old runtime and remaining transitional bindings. Carries **K3** (manifests carry operations, feeds, endpoints, settings, capabilities, lifetimes and `cli.ts`; lists derived; `exports` patterns; the `OperationId` brand from platform with the literal union derived here), **K5b** (per-module contract snapshots and the `contract-snapshot` rule), **K6** (the catalog parity test), and the dissolution of `Stack` and `http/runtime.ts`.

**3. Offers.** `server.ts` (the server process entry, from `http/main.ts`), `entries/cli.ts` (the `tagma` process entry, from `cli/main.ts`: it reads `process.argv`, hands the verb manifest to the `cli` door's `invoke(argv, verbs)` and sets the exit code — the door keeps parsing, verbs, printing and the exit classes), `modules.ts` (the ordered module list, section 1 §1.4.5: one entry per module), `manifest.ts` (the union and derived lists: `OPERATIONS`, `OPERATION_IDS`, socket-only and operator-only sets, operation text and notes, from `protocol/operations/index.ts`), `bodies.ts` (from `operations/index.ts`), `start.ts` (binding ports and hooks before admission: `EnvironmentBackend`, `RootPublished`, `CommitOverlay`, `CheckoutWriters`, `CheckoutHolders`, `ThreadLineage`, `SessionNames`, `PaceDoor`, succession and setup steps, the terminal adopters, `Harness` implementations (with the transitional bindings of §7.2.7 until each harness's `M1`; `composition` installs every row of that table and deletes the rest at `composition M2`), `ThreadExecution` ← invocation's `nativeDoor` (a transitional adapter over today's native tool door until `invocation M1`), `PreservationCommit`, `MergeNotice`, `NoticeTakeBack`, `ReadStillness`, the retirement-settlement and placed-threads hooks, the gauge hook, carrier admission; arguments: catalog content, doctrine sections, installation paths, the enforced-law contract), `testing/` (the test world).

**4. Needs.** Every module (manifest, argument, start). **5.** No tables. **6.** The boot phases and the shutdown order (`http/boot.ts`, `http/phase.ts`, `http/stop.ts`); the serve log bounding and the console record (from graph, §7.6). **7.** None.

**8. Target file map.** *(a)* (14 files, 3,276 lines):

| Current | Lines | Target | Notes |
|---|---:|---|---|
| `harness/Stack.ts` | 1,409 | **dissolves** (F4 gate, S2): each block of the assembly becomes its owner's `<module>.ts` layer — thread stores, rollout, list, acts, ending, library, evidence and delivery → threads; the native engine, compaction, keep-warm, workflows and the maintenance sweeps → native-harness; external sessions, observations, lanes, permissions, reports, births → external-harnesses; worlds → executions; worktree setups, renames, unborn → worktrees; finishing, pending merges → landing and worktrees; sandboxes and prepared trees → sandbox; assignments, targets → workspace and threads; root healing → workspace; the boot condemnation and scheduled sweeps → each owner's passes; what remains is the order and the start bindings in `start.ts` | `Stack`, `StackOptions` retire |
| `harness/owners.ts` | 58 | retires | `ThreadOwners` is the manifest's union |
| `http/runtime.ts` | 559 | at `composition start`, today's process runtime calls `composition/start.ts` once before admission (`http/runtime.ts` L472 → `harness/Stack.ts`); only at `composition M2` **dissolves** into `server.ts` (the process runtime) and the owners' layers: performance, traces, tokens, models, quota → providers and performance; the graph pool, judge graphs, remeasures, rule checks, commit queue and hooks → graph and enforcement; the thread stack → the harness modules; `markHeld`'s late binding removed (`heldChanged`) | `Runtime` → `ServerRuntime` |
| `http/main.ts` | 360 | `composition/server.ts` | the data claim, succession and builds call installation; the Orca import calls executions (§7.6) |
| `http/boot.ts`, `phase.ts`, `stop.ts` | 95 | `composition/boot.ts`, `phase.ts`, `stop.ts` | `settleFloor` → `settleJournal` (S7) |
| `protocol/operations/index.ts`, `operations/index.ts` | 200 | `composition/manifest.ts`, `composition/bodies.ts` | derived from manifests (K3); the `OperationId` brand → **`platform`** `contract/wire/ids.ts` (K0) |
| `cli/main.ts` | 13 | `entries/cli.ts`: the `tagma` process entry (argv, exit, the verb manifest handed to `cli`'s `invoke`) — section 1's territory stands; v2's correction to `cli` is withdrawn, and the §1.6.3 wording needs the amendment named in 7.5.26 | — |
| `cli/fixture.ts`, `cli/commitFixture.ts`, `cli/hookFixture.ts`, `http/doorFixture.ts` | 568 | `composition/testing/*` | with the fixtures other cards send here: `graphFixture`, `poolFixture`, `checkoutFixture`, `landingFixture`, `finishingFixture`, `sandboxFixture`, `preparedTreeFixture`, `storageHarness`, `captureDriver`, `capturedHooks` (both with the corpus location passed in, section 6 §6.8), `pageWorld`, `pageWorldServer`, `captured`, `fixtureHome` |

*(b) Parts received:* `files/serveLogBound.ts`, `files/serveRecord.ts` (graph, §7.6) → `composition/serveLog.ts`, `composition/console.ts`; `fixtureHosts.ts` went to executions (§7.6). 

*Parts received by name (v4, completing the send/receive pairs of §7.6.1):*
- from `graph/core/graphFixture.ts`, `graph/core/worldCost.probe.ts` (graph), `http/poolFixture.ts` (workspace), `harness/checkoutFixture.ts`, `harness/landingFixture.ts`, `worktrees/finishingFixture.ts` (landing), `harness/sandbox/sandboxFixture.ts`, `harness/sandbox/preparedTreeFixture.ts` (sandbox), `thread/storageHarness.ts` (threads), `socket/pageWorld.ts`, `socket/pageWorldServer.ts` (socket), `cli/captured.ts`, `cli/fixtureHome.ts` (cli) → `composition/testing/<same stem>.ts`, the test world (section 6)
- from `harness/captureDriver.ts` (native-harness) and `harness/capturedHooks.ts` (external-harnesses) → `composition/testing/captureDriver.ts`, `composition/testing/capturedHooks.ts`, each taking the capture corpus location from its caller (section 6 §6.2.3, §6.8)

*(c)* `Runtime` → `ServerRuntime`; `settleFloor` → `settleJournal`; `Stack*`, `ThreadOwners` retire. *(d)* none.

**9. Debt retired.** Every `X → composition` edge (graph 2, executions 2, enforcement 2, installation 1, native-harness 11, platform 2, threads 1, worktrees 1, settings 1) by platform's brand and derived arguments; `Stack.ts` F4 gate and S2.

**10. Graph work.** [[70db8905]] "The agent stack a thread runs in" is already dissolved by W6; the rest of the stack's claims (start order, boot phases) come to `#module` `composition` (`depends-on` every module, as the registry says). [[a115687f]] "The record a running server leaves of itself" comes here. The floor rule's one question (§7.2.6) is asked after this wave's M3.

**11. Acceptance.** At `composition start`, the old `http/runtime.ts` invokes `composition/start.ts` before admitting a call (not only in the new W7 entry); after `composition M2`, the server starts from `composition/server.ts` with every port and hook bound before admission; a mandatory unbound capability is an assembly error at start; `modules` covers every path with zero debt; the parity test (K6) passes; the contract snapshots (K5b) stand.

**12. Risks.** The dissolution of `Stack` and `http/runtime.ts` is the last step and touches every module's layer; each module's layer lands in its own wave, and this wave only deletes what is left, so a failure here is a start-order bug, found by the start test that binds every hook and refuses an unbound one.

## 7.6 Corrections to section 1's territory found while mapping

Reading the cards' files contradicted the territory in these places. Each correction is by meaning, moves a file or a part to the module whose concept it holds, and adds no relation to the registry; three of them create unregistered edges that §7.6.1 names with their removal. v3 withdraws two v2 corrections (`protocol/storage.ts`, `cli/main.ts`). They are applied to the territory and the first `modules` snapshot before P4 stands.

| File | Territory says | By meaning | Why |
|---|---|---|---|
| `protocol/projectionRefusal.ts` | platform | `threads` | it types `thread_rollout_refusal`, the rollout lane's table |
| `protocol/subjectBinding.ts` | platform | `workspace` | read only by the two working-binding files |
| `protocol/database.ts` | platform | split: store types → platform; `storeSizeSchema`, `vacuumSchema`, `vacuumRefusal` → `installation` | the wire and refusal text of `vacuum_database` |
| `projection/database.ts` | platform | `installation` | `vacuum_database`'s voice |
| `operations/currentProject.ts` | platform | `graph` | the call's served project and graph's caller codes |
| `fixtureHosts.ts` | platform | `executions` | it finds and ends execution-host processes |
| `protocol/numbers.ts` | platform | dissolves to each constant's owner | eighteen unrelated figures, each with one reader's owner |
| `protocol/modelSelection.ts` | providers | `native-harness` | a thread's model selection, defaults and favourites are `model_preference` |
| `protocol/threadTitle.ts` | thread-record | split: title sources → thread-record; the generation result → `threads` | naming is a model call `threads` makes; the record keeps the fact |
| `graph/projects/repo.ts` | graph (whole) | split: `identifyProject` → `projects`; checkout readings → `workspace` | a repository key is registration's identity; reading checkouts is workspace's (section 1 moved `CheckoutReads` there) |
| `ai/Models.ts` | providers (whole) | parts: `DEFAULT_MODEL` → native-harness, `CREDENTIAL_OWNER` → platform, `DEFAULT_INSTRUCTIONS` → its callers | see the providers card |
| `graph/projects/Sessions.ts` | platform (whole, with a named split) | as named: `inProject` → `graph` | confirmed by reading; recorded for the snapshot |
| `graph/projects/holders.ts` | workspace (whole) | dissolves: `agentNames` → thread-record; `heldTasks` → graph; the merge → workspace's `CheckoutHolders` hook | it names who holds a tree's lines and their tasks; appendix B read it as the removal hold |
| `protocol/checkoutStatus.ts` | workspace (whole) | split: the checkout row → workspace; the thread frame (L99–147) → `change-record` | a thread's files and commits are authorship |
| `protocol/workingOrigin.ts` | workspace (whole) | split: places → workspace; `TargetSnapshot`, `GraphOrigin` and their projections → `threads` | a thread's target is threads'; `TargetAt` stays below executions |
| `protocol/storage.ts` | graph (whole) | **withdrawn in v3** (v2 moved `CHECKOUT_DIRECTORY` to platform). It stays whole in graph as `GRAPH_DIRECTORY`; `workspace`, `change-record` and `sandbox` receive it as an argument through `composition` | section 1 §1.7 rule 11 and appendix B: graph owns storage paths and passes them as arguments |
| `working/TreeWatch.ts` | workspace (whole) | split: `watchAll`, `watchTree` → platform | the OS watch is platform's adapter (registry `workspace → platform`) |
| `graph/core/orcaProfile.ts` | graph | `executions` | a first-run import of `terminal.*` keys |
| `files/serveLogBound.ts`, `files/serveRecord.ts` | graph | `composition` | the running server's own record, set up at process start |
| `graph/core/graphFixture.ts`, `worldCost.probe.ts` | graph | composition's test world | the fixture assembles several modules (section 6) |
| `protocol/source.ts` | graph | split: `SourceCut` → **platform** as `ProcessProvenance`; installation cut, `Source`, restart → `installation`; the measurement (`http/sourceCut.ts`, installation already) is installation's producer | the value is a running process's provenance (launcher's adjudication, v4); graph's reflection receipt consumes it as an argument |
| `cli/commands/orientation.ts` | graph (whole) | split: `law` → graph; `status` → `installation` | `status` reads where the server and host stand |
| `operations/measure.ts` | graph (whole) | split: `read_installation_status` → `external-harnesses` | it reports the skill, hook and workflow installs in the machine's CLIs |
| `graph/core/refusal.ts` | graph | `platform` | every module's operations and channels fold failures with it |
| `graph/projects/git.ts` | graph | `platform` | Tagma's own tolerant git readings, read by installation too |
| `protocol/text.ts` | graph | `platform` | a neutral schema helper |
| `protocol/files.ts` | graph | **withdrawn in v5** — stays graph's | `read_path_exists` checks the checkout graph serves, so the operation and its report are graph's; workspace supplies `pathWithin` (review B2) |
| `cli/commands/setup.ts` | installation (whole) | split: `auth` verbs → `providers` | accounts are providers' |
| `cli/commands/files.ts` | change-record | `graph` | `log` and `resolve` act on the graph's tree |
| `thread/ThreadFloor.ts`, `thread/ThreadProjection.ts` | native-harness | `threads` | the rollout writer mints journal positions for every thread and the projection fills `thread_event`, cursor and refusal rows — the journal lane |
| `thread/portCrossing.ts` | threads | `platform` | store crossing helpers read by sandbox's stores too (appendix B) |
| `harness/captureDriver.ts`, `thread/storageHarness.ts`, `harness/capturedHooks.ts` | native-harness, threads, external-harnesses | composition's test world (the capture files with the corpus location passed in) | section 6 §6.2.3, §6.8 |
| `cli/commands/harness.ts` | external-harnesses | `threads` | its verbs are turns of native threads, dispatched through `Harness` |
| `cli/main.ts` | composition | **withdrawn in v3** — stays composition's | only composition may hand every module's verbs to the door; the §1.6.3 wording is the amendment (7.5.26) |
| `http/wire.ts` | http | `graph` | block-write and batch-outcome answers are graph's voice |
| `socket/*Channel.ts` (9 files) | socket | each feed's owner (graph, threads, executions, workspace, change-record, worktrees, native-harness) | K3: feeds are declared in their owners' manifests and served generically |
| `socket/pageWorld.ts`, `pageWorldServer.ts`, `cli/captured.ts`, `cli/fixtureHome.ts` | socket, cli | composition's test world | fixtures |
| `harness/resources/sandbox.ts` | sandbox | `threads` | the thread-resource adapter for guests (Astra C11) |
| `harness/sandbox/sandboxFixture.ts`, `preparedTreeFixture.ts` | sandbox | composition's test world | they assemble several modules |
| `working/releaseAbandonedHolds.ts` | worktrees | `executions` | it joins root uses against executions' terminal, command and wait rows |
| `harness/checkoutFixture.ts`, `harness/landingFixture.ts`, `worktrees/finishingFixture.ts` | landing (`delivery` in section 1's script) | composition's test world | each assembles several modules (section 6) |
| `working/WorktreeFinishing.ts` | landing (whole, with a named split) | as named, confirmed by reading: merge, pull request, interrupted-merge recovery → landing; archive, restore, forget, delete → worktrees; `updateFromBase` → threads | recorded for the snapshot |

**Registry patterns widened** (no relation added; each pattern names what already crosses): `workspace → thread-record` key-ref → key-ref+port-binding (`ThreadLineage`); `graph → workspace` service+event → service+event+hook (graph's tasks in `CheckoutHolders`); `change-record → workspace` keeps service+event+hook, now naming `CommitOverlay`, `CheckoutWriters` and `CheckoutHolders`.

### 7.6.1 Reconciled territory, source→target pairs and the milestone graph — the v5 control

**Scripts and what each proves** (retained in the author's scratch, `…/01a0e398-f352-73cc-b76d-a152a2b96fe5/control/`; rerunnable in seconds; nothing in the checkout or the graph is touched):
- `spec-01v10-territory.mjs` (section 1's script, unchanged logic) over `98d8d3a216` → `baseline-mods.json`: each of the 891 non-test `.ts` files with its section 1 owner and every relative import. **Measured.**
- `control.mjs` → `control-v3.json`: the §7.6 corrections that change a file's physical owner (45 files after `protocol/files.ts` stays graph's in v5) applied; exactly one physical owner per file; module edges before and after. **Measured** over the baseline's imports.
- `control2.mjs` → `control-v5.json`: **structured** source→target reading of this file. It parses the markdown tables of each card's part 8 — a row's first cell is its source set (paths, bare stems under the row's directory, `dir/*` globs, the `<kind>` rule) and its other cells the target — and part 8 (b) as the receiving side. It checks: every file is the source of a part-8 row; which rows sit in a card other than the file's corrected owner (the territory corrections, listed in the sender's card); every row whose target names another module in backticks or bold after an arrow, as a **grouped** target (`**graph** — `a`, `b``), or as *composition's test world* is a **send**, and the receiving card's (b) must name that file; every (b) table row must have a sending row naming the receiver, or a group row that retires the file.
- `milestones.mjs` → `spec-07-milestones.json` beside this file: the task graph of §7.2.2. **Generated**, then checked.

**Results.**
- **Territory:** 891 files, one physical owner each; 45 moved by §7.6's corrections after the served-tree path-exists shape stays graph's (B2).
- **Source→target:** 891 of 891 files are sources of a part-8 row. 124 sends, **0 without a receiving entry**; 83 received table rows, **0 without a sending row**. 45 files are listed in a card other than their corrected owner — the §7.6 corrections — and 43 carry a matched send to that owner; the other two, `cli/captured.ts` and `cli/fixtureHome.ts`, are sent in the cli card's prose and received in composition's (b). Two files sit in two cards' rows: `api/performance.ts` (http's file, repeated in performance's card for its routes) and `harness/agents/declared/DeclaredAgents.ts` (threads' file, also swept by native-harness's `harness/agents/*` glob, whose row names the files that stay native).
- **What the maps now include:** a row for `graph/projects/repo.ts` in its sender (the split was only in its receivers); separate rows for `protocol/text.ts`, `protocol/files.ts`, `protocol/identity.ts`, `protocol/rows.ts` and `protocol/harnesses.ts` so each carries its own target; receiver entries for the 27 doctrine sections, the page families, the numbers, the socket feeds, `http/wire.ts`, the fixtures and capture files, `cli/commands/files.ts`, `cli/commands/harness.ts`, `harness/submitWork.ts`' prepared-change parts, `protocol/threadTitle.ts`, the vendor prefix and four platform receipts; sender notes naming `executions` (`machineStanding.ts`), `change-record` (`CheckoutReads.ts`), the ten key owners (`protocol/settings.ts`), `platform` (`db/schema.ts`, `protocol/operations/index.ts`); and `graph/core/BatchSources.ts` (v3). V5 keeps `protocol/files.ts` with graph (B2), names the checkout picture as a retained HTTP resource (B1), carries the `HeldTaskLabels` binding (B3), and registers `accounts.subscribe`, `awake.subscribe`, `pace.subscribe` with their feed owners (D1).
- **Limits of this reading.** It pairs files, not symbols: a row's notes naming which symbols go where are read by the author, not verified by the script. A send phrased only in prose (the cli card's (a)) is not parsed as a send. A table row's line ranges come from the fact sheets (below). This is exact evidence that each file has a stated destination and that the two sides name each other; it is not proof that the maps preserve runtime construction — §7.2.7's bindings and the start test at each `M1` carry that.

**Relation patterns** (module edges over the baseline's imports, section 1 territory vs the corrected territory): 265 → 266 edges; outside the registry 139 → 138; vanished 5 (`change-record → cli`, `cli → change-record`, `landing → thread-record`, `sandbox → threads`, `sandbox → native-harness`); pattern changed 14 (as v3 listed). The corrections create three edges outside the registry, each now closed by meaning:
- `thread-record → threads` (`db/thread.ts:40 → protocol/projectionRefusal.ts`): ends at W2a, when `db/thread.ts` dissolves and `thread_rollout_refusal` moves with its type into threads' store.
- `executions → http` (`socket/terminalChannel.ts:24`, `socket/commandBytesChannel.ts:6 → http/handlers/terminals.ts#actorOf`): `actorOf` and `terminalActorOf` move to `executions/terminals/access.ts` in executions' wave, both transports switching together (7.5.14 (b)).
- `native-harness → installation` (`projection/toolAnswer.ts:26 → projection/database.ts`; `protocol/toolResult.ts:8,11 → protocol/database.ts`, `protocol/source.ts`): the vacuum answer and voice reach every tool voice through installation's manifest; `SourceCut` becomes platform's `ProcessProvenance` and the reflection receipt graph's (launcher's adjudication, 7.5.1, 7.5.7, 7.5.9, 7.5.21). No new relation.

**Milestone graph.** 126 tasks (27 × `M1`/`M2`/`M3`/`N`; P0–P5; `invocation K5a`; `D4` with runtime readiness; six `W2a` store steps; `composition start`, `landing preservation`, `perf E5`, `D9 E8`), 646 `waits-on` edges, **acyclic**, no dangling task; first ready: `P0`, `P1`; longest chain 23 tasks. Incoming consumers for `N` are the union of the target registry's reverse edges and the corrected current imports (doors, fixtures and cut edges included). The generator asserts all added obligations, each true: `graph N` waits on `http M2`, `socket M2`, `cli M2`; `composition M2` waits on every other module's `M2`, doors included; `projects M2` waits on `invocation K5a`; `settings M2` waits on the `M1` of ten key owners, none waiting on `settings M2`; `P4` waits on `P3`; `composition N` reaches `composition M2` through `composition M3` without a self-edge; `thread-record M2` waits on `D4`; `projects M1` waits on `composition start`; `worktrees M1` waits on `landing preservation`; the thread and harness `M2` tasks wait on `perf E5`; `socket M2` waits on the feed and act owners' `M2`; `D9 E8` follows E5 and both harness `M3` tasks. Acyclicity alone is not proof of those edges.

**What was read for v5, and what rests on fact sheets.**
- Re-read by the author against the baseline in this revision: `harness/HarnessBirths.ts` (L50–180), `harness/HarnessSessionStore.ts` (table use), `http/handlers/terminals.ts` L25–40, `protocol/terminalActor.ts`, `protocol/source.ts`, `http/sourceCut.ts`, `projection/toolAnswer.ts` (L20–30, L140–146, L425–437), `protocol/toolResult.ts` (L8–12, L200–212), `graph/work/Reflection.ts` (L38–46, L113–131), `projection/lines.ts` `sourceLine`, `api/agents.ts` and `http/handlers/agents.ts`, `harness/agents/library.ts` `skills`, `protocol/agentLibrary.ts` L89–101, `api/threads.ts` (every endpoint's schemas), `api/database.ts`, `http/handlers/{database,gauges,performance,projects}.ts` (routes), `harness/agents/code/agent.ts`, `graph/core/Selection.ts` `roots`, `terminals/Terminals.ts` (helper definitions L2438–2649 and their call lines), `harness/commandSignalSend.ts` L30–50, `harness/submitWork.ts` carrier lines. From v3: the files that revision named.
- V5 seam readings: the four Sol slice reviews [[23a1feed]] each read their cited paths; I re-read the current `http/handlers/files.ts` path-exists implementation (L149–167), `http/handlers/checkouts.ts` picture headers (L56–69), `socket/rpc.ts`'s act and feed schemas, `socket/threadChannel.ts`'s act dispatch and refusal wrapper, and the accepted §3.13 addendum [[9c085c6c]] (§3.13.10, §3.13.13, §3.13.15). The other review line ranges are the reviewers' evidence, not a full reread of all 891 files by me. The remaining split ranges rest on Muse fact sheets (`facts/concepts-job-01…15`, each read whole by a collector at the baseline); a builder confirms them in the wave's delta review.

## 7.7 Names this section decides

Section 5 v3.1 answered the rest of v1's questions (the F1 exemption, the reserved words, `landing`). These are the designer's calls, made by meaning; builders use them as written.
- **`NameSource`**, not "title source", for today's `NameOrigin`: the type records how a thread's **name** was given (`generated | chosen`), and the glossary keeps name and title apart. `TitleSource` replaces `ThreadTitleOrigin`.
- **`project_policy`**: the graph-owned row holding `strict_provenance`, `private` and `storage` — what the graph does with a project, not what the project is.
- **Symbols:** `StoreDb` (the store's database handle), `WriterRegister` (each store's register of writers: the glossary's session sense), `OwnGitError` (Tagma's own git invocation, not the shadow's), `FileReach`, `WorkingPlace` (a call's proved root and working origin; workspace's), `VoiceRefusal` and `VoiceAck` (the envelope every operation voice answers with), `ModelAccess` (access to model providers, not "models"), `DefaultAccounts`, `ThreadRecords`, `ThreadTitleStore`, `NATIVE_RUN_SCOPE`, `credentialMissing`.
- **Operations** (section 5 §5.4.6 grammar): `list_projects`, `read_project`, `add_project`, `set_project_root`, `remove_project`, `set_project_policy`, `set_project_storage`, `reload_workspace_sources`, `read_workspace_sources`, `read_compaction_summarizers`, `list_accounts`, `read_cache_lifetimes`, `refresh_accounts`, `set_default_account`, `read_sign_in`, `begin_sign_in`, `complete_sign_in`, `discover_accounts`, `import_accounts`, `remove_account`, `rename_account`, `read_provider_token`, `save_console_key`, `remove_console_key`.
- **v4 names:** `ProcessProvenance`, `processProvenanceSchema`, `provenanceLine`, `measureProvenance` (a running process's provenance: platform's vocabulary, installation's producer); `ReflectionFiled` (graph); `executionActor`, `executionActorOf` (execution admission, executions); operations `create_thread`, `list_thread_window`, `list_thread_types`, `locate_thread`, `mark_thread_seen`, `set_thread_title` (threads), `read_model_defaults`, `set_model_defaults`, `read_model_favorites`, `set_model_favorites`, `read_thread_snapshot`, `read_thread_held`, `read_thread_composition`, `read_thread_trace`, `read_agent_skills` (native-harness), `list_root_blocks` (graph); files `sources/verification.ts`, `evidence/threadEvidence.ts`, `terminals/refs.ts`, `birth/sessionBirths.ts`; `WorktreeRequest`/`WorktreeIntent`.
- Names the later cards decide are listed in each card's part 8 (c), with their reason where it is not obvious. The table names they decide under section 5 §5.4.6: `terminal_request_key` and `terminal_request_key_tally` (← `terminal_operation*`, two records, not merged into `terminal_intent` — 7.5.14), `worktree_intent`, `worktree_archive_intent` (7.5.17), `landing_intent`, `merge_receipt` (7.5.18); `WorkingPlace` is the call's root and origin and today's `WorkingPlace` becomes `PlacedPath` (7.5.6).

## 7.8 The remaining questions of rule [[8dab19b6]]

1–9 are §§7.1–7.5: the outcome (§7.1), the problem (a builder today would start from directories and invent names; section 5 §5.2), what holds now (the measurements named in each card), the target model (§7.2–7.4), owners (each card's part 1), rejected alternatives (below), acceptance (§7.1 and each card's part 11), claims and tasks (each card's part 10), the order (§7.2).

**Rejected alternatives.**
- **Waves strictly by section 1's groups, each group waiting for the previous one to close.** It serialises 27 waves into eight gates and idles builders on work they do not depend on. The start rule waits only on what the registry says a module needs, and only on its dependencies' contracts.
- **A module may open before its dependencies' M1.** It would build against paths that are about to move, and every such wave would be rewritten twice.
- **Narrowing when a module's lower dependencies have closed (v2's rule).** Narrowing a module's entries turns its **consumers'** unmoved imports into violations; its dependencies are irrelevant to that. `N` waits on the incoming consumers' `M2` instead (§7.2.2).
- **Milestones as prose on one task.** A task held through `M3` cannot release a `waits-on` at `M1`; each milestone is its own child task so the edges and `list_ready_tasks` carry the start rule.
- **Mixed files split by one dedicated "split" task up front.** It moves each file twice (once to split, once into its wave) and races every wave that touches it. The first wave that needs a part moves it (§7.2.5).
- **Maps written by builders during the wave.** Section 5 §5.4.7 forbids it: names are fixed before the wave.

10. **Contract.** The ten thread socket acts keep their current input, answer and `refusalSchema` shapes as operations (7.5.20); `act-spent` is the additional refusal already required by accepted [[9c085c6c]] §3.13.15 for keyed writes. The cards turn typed routes into operations through K2 with K5a's aliases, and no typed route retires before its operation and alias stand (the binary thread routes stay HTTP resources, 7.5.20). Renamed operations (`read_overview`, `list_ready_tasks`, `*_checkout`) resolve old and new ids to one canonical identity; the journal answer `landed` → `recorded` is a same-build rename whose reader keeps reading stored `landed`; `requestKey` replaces `operationId` through `renamed`. `Actor`'s arm rename is in-memory. The `packages/agent` cut is section 6's to version: the hidden native default is removed, and composition supplies the old runner explicitly through the required port until `native-harness M1` (§7.2.7).
11. **Stored data.** The migrations are section 2's: D4 (thread split and current-path runtime switch, owned by `thread-record`'s task before its M2), D6 (`default_account` in W1 with the live model-selection paths switched before its column is dropped; `approval_preference` and `model_preference` in W6), and `project_policy` (graph, W3; until then the policy columns stay in `project`). Accepted [[9c085c6c]] §3.13.15 additionally requires the graph revision/index tables and triggers, the authoritative thread call and spent-key records, `fold_rev`/`inherit_rev` and their triggers in both products' chains, all landed with `perf E5` (one source change, §7.2.4). `landing preservation` adds the keyed publication's intent/witness/receipt before `worktrees M1`. The vocabulary format marker and its newer-format refusal run as release N before any release writes section 9's vocabulary (P0, P2). Rollback is section 2 §2.10, with three separate installation contracts (7.5.9): registry restore (projects, settings, graph), the downgrade preflight (enforcement's commit queue closed and drained: `waiting = 0`, `unread = 0`, else refused) and the console-key rollback (providers, into the snapshot copy only).
12. **Who may do what.** The operator approves this section (§7.2.6). A card's designer writes its map; `zone-reviewer` or the wave's reviewer reads it before the wave opens; a builder applies it and asks the designer about anything it does not cover. `modules`, `names` and [[f49f228f]] refuse what they forbid; every loosening goes through `enforce_rule` in the open.
13. **Long-lived things.** Wave tasks live until their `N` child finishes; each milestone child ends at its merge; debt entries retire with their violations. Transitional bindings (§7.2.7) live from the declaring module's `M1` to the named replacement milestone and are listed in each wave report until gone; `composition M2` deletes any left. A mixed file's remainder is owned by its primary owner until that wave. The remainder of `protocol/settings.ts` is `settings`' until the last key owner's `M1`, then deleted at `settings M2`.
14. **Bounded resources.** Wave worktrees are created through `create_worktree`, never by hand; each costs one checkout and one graph store, and section 3's budgets and admission apply to them as to any worktree. How many stand at once is a storage and admission question — the start rules keep it near the width of the level table (4 at levels 3 and 8), and an idle checkout is not a CPU worker. Inside a wave, fan-out obeys [[8925d705]] (at most six concurrent processes per fan). Neither figure limits the product's target of 10–20 concurrent agent sessions.
15. **Rollout.** Every wave merges at `M1`, `M2`, `M3` and `N`, and the system builds and runs after each merge; early `composition start` is invoked by today's runtime before admission, `landing preservation` precedes worktrees, D4 runs before thread-record M2 and before admission, and `perf E5` switches the kernel port, both adapters and the journal lane in one source change. Running threads meet moved code only through server restarts, and each renamed operation through its alias (section 4 §4.4.8).
16. **Failures.** A wave that stops half-way leaves its debt owned by its child tasks; a dependent starts after its published runnable `M1`, except the explicit D4, K5a, E5, preservation and assembly barriers of §7.2.2. A D4 that dies mid-way resumes (section 2); an archive replay consults the keyed preservation receipt, and `act-spent` refuses re-execution of a keyed transition whose result was retired ([[9c085c6c]]). An overlapping edit between two waves on one file is coordinated, never won: the second builder reads the current region and its authorship, preserves both writers' work by meaning, and asks the other writer one concrete question about the conflicting lines while the rest of its work continues (§7.2.5). A delta review that finds the card's baseline stale amends the card before the wave cuts anything.
17. **Observability.** `modules` and `names` debt per module, falling per wave; `list_ready_tasks` (the `M1`/`M2`/`M3`/`N` child tasks and their edges) shows which waves may open; each wave report reruns the registry checker and the territory control and states its milestone.

**Amendments this section needs in accepted sections** (listed, not made; the launcher reconciles them). Distinct from obligations the accepted sections already carry, which earlier drafts had missed and v5 now applies without a new decision: the two-release vocabulary barrier (section 9 §9.15), §8.9's order (P3 before P4), graph-owned storage paths as arguments (section 1 §1.7 rule 11), section 5's operation, journal and key renames, the downgrade preflight (section 5 §5.4.8), `Harness.quiet` as an atomic admission lease and `Harness.retract` in the command's unit (section 1 §1.4.3, §1.15).
1. **Section 1 §1.6.3:** "the CLI process" → "the CLI door"; the process entry (argv, exit, the verb manifest) is `composition`'s, as §1.3 says (7.5.26, 7.5.27).
2. **Section 1 territory (§1.13 / the script):** the corrections of §7.6 — among them `protocol/source.ts` split into platform's `ProcessProvenance` and installation's cut and restart shapes (launcher's adjudication, v4), `cli/main.ts` staying `composition`'s, and `protocol/storage.ts` staying graph's — applied to `spec-01v10-territory.mjs` and the first `modules` snapshot before P4.
3. **Section 1 §1.4.3 (ports and hooks):** add `DowngradeSteps` (installation declares, enforcement fills; 7.5.9, 7.5.15) and `projectPolicyChanged` (graph's post-commit event, installation subscribes); note that `ThreadExecution`'s implementation is invocation's `nativeDoor`, and that the vacuum answer and voice reach tool voices through installation's manifest.
4. **Section 5 F3:** the gate excludes only the exact paths a card lists with one subject and the reason its directory makes the short stem honest — the sixteen of §7.4.2; F3 keeps measuring every candidate and stays at gate (§7.4.2).
5. **Section 5 F2**, only if the review prefers it: an exemption for shadcn-style compound component directories — part 2 (`primitives`) otherwise renames them; the app's **generated** shadcn copies need section 5's generated-code exemption stated for F2 as it is for F1.
6. **Section 8 §8.8 / §8.7:** §7.4.6's source plan — one indivisible claim keeps several narrow sources; a source move is never a supersession; address, source owner and parent change through `reanchor_path`, `anchor_block` with `fromId` and `update_block` — is section 8's procedure made operational; if §8.7 reads otherwise, it is amended to match.
**Already accepted, still to be incorporated at implementation:** [[9c085c6c]] §3.13.15 explicitly amends sections 1 (one journal lane, prepared native folds), 2 (revision/index tables and authoritative records), 3 (one heavy-slot arbiter and held-class token waits), 4 (`act-spent` and keyed records) and 6 (the keyed kernel transition port and both adapters). This section accounts for them in `perf E5` and the affected cards; it does not edit those graph decisions. Section 9 needs no amendment. The unfinished package and app cards (part 2) are not evidence that any prerequisite here holds.

## 7.9 What the early cards leave to later cards

Each later card (§7.5.6 onward) names these parts as received:
- **`graph`**: the remainders of `graph/projects/Projects.ts` and `graph/core/Settings.ts`; `inProject`; the shadow repository and `gitIdentity` from `files/ShadowGit.ts`; the refusal code unions (`CallerRefusal`, `OpenRefusal`, `ReferenceRefusal`, `ServingRefusal`); `Lens`, `NameReach`, `ProjectCall`, `CurrentProject`; `project_policy`; its keys and page families; `protocol/projects.ts`' policy names.
- **`workspace`**: `WorkingPlace` from `protocol/caller.ts`; `encodeBinding`; `repo.ts`' checkout readings; its page families.
- **`installation`**: the vacuum wire, refusal and voice; the ports; the store's path arguments; the registry participants of `projects`, `settings`, `graph`.
- **`executions`**: `fixtureHosts.ts`; the `terminal.*`, `host.*`, `command.*` keys; its page families; the migration report of `db/landedReports.ts` as a contribution to the store's report registry.
- **`threads`**: the thread subjects of `protocol/session.ts`; `projectionRefusal.ts`; the title generation result; the agent-list figures; its keys; `approval_preference`; the rest of the W2a/D4 tables.
- **`native-harness`**: `protocol/modelSelection.ts`, `DEFAULT_MODEL`, the rest of `AccountDefaults.ts` and `ThreadOwnerSettingsStore.ts`, `model_preference`, `NATIVE_RUN_SCOPE`; the rest of `ThreadStore.ts`; the envelope parts of `protocol/toolResult.ts` it confirms to `platform`.
- **`external-harnesses`**: the title adoption's binding check; the vendor session prefix and identity variables handed to `platform`; `harnessTitle`; `CURSOR_SESSION_START_CHARS`.
- **`cli`**: the verb contract's parts moved to `platform`; the domain renderers of `cli/operatorOutput.ts` to their owners.

**Parts the later cards send back to `platform`** (its card, §7.5.1, lands them at its M2, or the sending wave lands them as a platform change if platform has closed): the OS watch primitive `watchAll`, `watchTree` (7.5.6); `refusing` ← `graph/core/refusal.ts`, the tolerant git readings ← `graph/projects/git.ts`, `trimmed` ← `protocol/text.ts`, `refusalLines` (7.5.7); the store crossing helpers ← `thread/portCrossing.ts` (7.5.19, 7.5.20).

## 7.10 Cards for the packages and the app — planned

Section 5 R8 requires the `names` debt to cover the app and the packages through their own cards; until they stand, `names` runs over the server region only and says so (P5, §7.2.1). The cards are written in part 2, `spec-07-packages.md`. They follow the same template, with three differences: the wave is section 6's build step (its P0–P4) instead of a server wave; "needs" reads section 6's package → package registry and its reach table (§6.3.2) instead of section 1's; and each package card names any stored form or cross-process contract it actually owns (section 6 §6.4.1); the app uses the generated client of section 4 K2.
- **37 package cards**, one per package of section 6 §6.2.2: the 35 that exist and the two new ones (`paging` from `agent/src/agent/paging.ts`, the **mechanism only** — `agent-tools`' GLOB, GREP and LISTING families stay in `agent-tools`, which drops only its duplicated ceiling arithmetic, as section 6 v2.1 and part 2's `paging` card say; `held`, created in E0). The heaviest maps are `agent` (53 F2 signals, 15 files over 600 lines), `llm` and `execution-host` (section 5 §5.2.2).
- **One app card** for `apps/tagma/app`, with one sub-map per feature of section 6 §6.5.3 (`features/harness` → `features/threads` with native and external sub-views; `features/terminals` → `executions`; and the rest as §6.5.3 aligns them), and one card for `apps/tagma/desktop`.
- **Order:** written after the server cards; each group's standing widens the `names` region through `enforce_rule` (a tightening) and records that group's debt with the owning card's task. A package card's wave is the section 6 build step that changes the package (section 6's own P0–P4, distinct from §7.2.1's preparation steps: P0 for `paging` and `held`, P2 for the kernel's ports, P3 for the app, P4 for the kernel's exports). A package no step changes gets a rename-only wave, run beside the server wave that first imports its renamed symbols.

## State of this draft

- **v5 (this file):** 27 of 27 server cards reconciled against the final four Sol slice reviews [[23a1feed]] and the accepted §3.13 addendum [[9c085c6c]]. No further review round was requested. The v4 text is kept in the author's scratch (`spec-07-cards.v4.bak.md`).
- **Evidence:** §7.6.1 — the structured source→target control (`control2.mjs`, `control-v5.json`), the territory and relation control, and the generated milestone graph `spec-07-milestones.json` beside this file with its asserted obligations; what the author read versus what rests on the reviewers and fact-sheet line ranges.
- **Not in this file:** the 38 package cards and the app and desktop cards — part 2, `spec-07-packages.md` was 22 of 40 when this file was written; independent authors complete it. No code or enforcement activation starts from this draft.
