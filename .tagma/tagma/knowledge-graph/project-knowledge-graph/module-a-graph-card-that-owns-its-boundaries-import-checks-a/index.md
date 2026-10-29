---
id: 01a0fa5f-4076-7fff-bf81-4c5c0ce061a6
title: Module — a graph card that owns its boundaries; import checks assemble modules from cards
ord: 221
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## What we get

The project graph becomes a map: a module is a card holding everything about one part of the product in one place — what it is and why, its code, what it opens outward, what it depends on, its notes, and its rules. The import boundaries every commit checks are read from these same cards: one truth, no second list in rule parameters.

Today the module list lives in several places and diverges: 69 modules in the [[083d37f1|module rule]] parameters, their own floor lists in [[f49f228f|server floors]], [[94d54cd1|agent floors]], fd247128 (llm) and 39817e41 (code-facts), a folder list in [[0d2c66a9|low floors]], and 38 #module cards cut differently. 219 of 359 territory paths and 125 of 902 entries already point nowhere.

The operator and the agent open a module card and see: description, territory, entries, edges both ways, floors inside, notes, and module rules. A parent card (“Tagma server”) shows children as layers derived from the edges.

## Model

**A #module card** is the sole owner of a module's boundaries:
- `id` — a short stable key, as in the rule today (`graph`, `@runlith/agent`): fingerprint and debt stand on it, so debt survives a move without rewriting;
- `kind` (kit/product/surface/substrate) — stays; the prime map stands on it;
- root — exactly one dir source of the card. File sources are cut-outs only (today these are 8 itests in composition). A file belongs to the module with the longest covering path;
- `entries` — a field: `{at, for → cards, role: port|testing}`, `at` — a path from the module root. No entries means the module is closed;
- edges — `imports` and `imports-tests` edges between cards (`from` imports `to`);
- `order` — floors of paths inside the module, bottom up, from the root (`.` is the root itself). `floorCrossings` semantics from today's `direction`: a file stands on the floor of the longest covering path, an import between floors goes only downward, one floor crossed, a file with no floor is free; every selected file without a test infix is judged, plus files under `testing` entries. Violation fingerprint: `<module> order <file> -> <entry>`;
- card text — one paragraph in English: what it is and why.

`reanchor_path` of the root moves the module whole: `entries.at` and `order` are paths from the root, so moving a folder does not break them. This is an address change, not law, and it is not gated.

**Nesting.** A module may lie inside a module. A module with child modules has no code of its own and no edges: the check sees only leaf modules, the parent territory only widens the region, and a file covered by no child becomes `uncovered`. “Tagma server” (05042d40) is the parent of 27 children in `apps/tagma/server/src` (26 new ones plus 7abcb9a1), its root narrows to `apps/tagma/server/src`. The server's scripts, workflows, and `drizzle.config.ts` stay outside the region, as today; dead `bench-admission.ts` and `release-abandoned-holds.ts` (imports of nonexistent `src/db`, `src/working`) are deleted.

**region is not stored** — it is the union of the territories of all #module cards, parents included.

**No floors are stored between children.** Edges are acyclic (`cycles: refuse`), layers are their topological order; the parent card shows them.

**No edge inheritance.** An edge is declared on the module whose code imports. Raising packages to the parent cannot be done without weakening: doors (http, socket, cli, doors) and performance would gain a domain (agent, llm, executions, inspection…), breaking the [[4657a163|invocation rule]]. Repeated edges to kit packages are grouped by display, not storage.

## One builtin

`modules` (apps/tagma/inspection) gains the module's `order`. `boundaries` and `direction` are deleted whole. Intra-module floors move into card `order`:
- server children with `contract/wire/` (24) — `order: [["contract/wire/"], ["."]]`;
- `@runlith/agent` — today's 19 floors from [[94d54cd1|agent floors]] prefixed with `src/` plus a top `src/` floor: a new file stands above all, and importing it from below is refused;
- llm — `[["src/profiles/{anthropic,deepseek,kimi,muse,openai,xai}.ts"]]`;
- code-facts — `[["src/"], ["src/languages/"]]`.

The [[f49f228f|server floor]], [[94d54cd1|agent floor]], fd247128, and 39817e41 rules are removed from enforcement (`strictness: off`) and deleted: their law now lives in `order` and edges. Body [[083d37f1|module rule]] keeps one sentence: inside a module imports go only down the card's `order`; the phrase “this rule's parameters change through `enforce_rule`” becomes “module boundaries change through `set_module`”.

Accepted relaxation: a file without an infix under `X/testing/` is test code, and an `X/testing → Y/testing` import from a lower child to an upper one becomes allowed (0 such imports today).

`tightens` on every builtin is dead (the server never calls it) — deleted. tsconfig `paths` and `imports` resolution lives in code-facts and stays; the false phrase in `modules` limitations (“paths and imports are not read”) is rewritten.

## How checks take modules

An inspection declares on its builtin that it takes the module map (in this work — only `modules`). The saved enforcement document holds no map — only policy and debt (base, tests, conditions, reads, cycles, coverage, unresolved, files, built, debt). The server assembles the map from cards in one place and substitutes it into each builtin declared so; inspection stays pure kit and knows nothing of the graph. Cards are found by the server through a behaviour-contract on #module (tag literals are forbidden in code, cf4c85f0), the builtin does not name the id. Assembly lives in the `enforcedRules` snapshot (enforcement/rules/reach.ts) and in `planEnforcement`; a rule revision carries the assembled map, a boundary edit shifts it.

- `names` ([[6b3210c7|650 lines]]) is untouched in this work: its `files.exclude` also judges `apps/tagma/app` (550 files, 13 debt entries) which is not on the map. It moves to the map with the app task.
- [[0d2c66a9|Low floors]]: a path-list item may be `{module: id}` expanding to the module territory relative to base; plain paths (`threads/doctrine/`) stay paths.

## Editing boundaries

Module boundaries — creating and deleting #module, `id`, root and cut-outs, `entries`, edges, `order` — are written by one `set_module` operation, modelled on `enforce_rule`:
- takes several modules in one call (a new package with its edges);
- plan: assemble the new map and re-measure every enforced rule whose assembled map changed; a new violation refuses with `debt-grows` unless named in `absorb` with owners in `owners`;
- apply: cards and rule ledger in one transaction; an `enforcement-stale` refusal only when HEAD moved under paths the measurement stands on (`movedUnder`), as with `enforce_rule`;
- a root, cut-out, or entry on a path missing from the working tree refuses; measurement goes by HEAD;
- an edge or `for` on a module with children refuses;
- `update_block`, `link_blocks`, `anchor_block`, and other generic doors refuse on #module boundary parts and name `set_module`. Text and `kind` are freely edited.

An agent adding a folder under `apps/tagma/server/src` calls `set_module` in the same change — otherwise the commit fails with `uncovered`.

## Rule reach

Reach is now computed in two places — `enforcement/rules/reach.ts#placesUnder` and `graph/orientation/law.ts#regionsOfPlace` (delivery, scanning every project source on each call) — and equals the sources of all descendants of the block, including finished tasks: server rules reach the agent in `apps/tagma/inspection`. It becomes one owner function for both:
- a rule with its own dir/file sources acts only on them;
- otherwise — on the territory of the nearest ancestor module (its own and its children's);
- at the project root — on the whole project;
- sources of tasks, specs, notes, and neighboring rules do not widen reach.

## Sections

The #area tag is deleted. This work mechanically converts all 435 #area into untagged notes: text as is, same place, sources removed. Each of the 108 rules under sections gains the dir/file sources of its section — reach stays exact. General migration rule: a rule whose ancestor module disappears gains the dir/file sources of that block (e.g. eb6b5286 under cc59eadf gets `apps/tagma/app`). A substantive pass over the notes (keep “how it works and why”, in English, delete the rest) is a separate work after.

Rewritten: the #module prompt in `codeProject.ts` (no “areas/zones” and “law in the rules that govern it”), the catalog body (areas/zones), the `areas` section of the orientation profile; TERRITORY binding leaves with #area.

## Migration

A one-shot step in the new code, running on first start after the operator's restart, in one graph transaction: reads lists from raw document 083d37f1 and `order` sources from f49f228f, 94d54cd1, fd247128, 39817e41, writes cards, fields, edges, and documents, retags #area. The next commit after the run deletes this step ([[acb620dd|no legacy]]):
1. Of 69 modules 35 have cards (fields and edges move over), 34 are created — 26 server children and 7 packages (paging, held, github, file-lock, agent-zod, execution-host, i18n). Server sections are not retagged as modules — the cut differs.
2. Roots are the 69 folders, cut-outs the 8 composition itests; dead paths and files inside their own folder do not move over. Entries — 777 live of 902, minus 8 testing entries on itests (nothing imports them).
3. Rule documents lose module maps, four floor rules are deleted, the 083d37f1 text and `modules` limitations are rewritten.

cc59eadf (app) and e5d293e5 (checks/law) are out of this work and wait as notes for their tasks:
- app: code-facts outlives the generated `extends` (`.svelte-kit/tsconfig.json`) and resolves SvelteKit `$lib`/`$app`/`$env` — also clearing 2 layer debt entries (owner cdf2a89f);
- checks/law: deciding which enforcement and inspection entries law opens.

## Tails in the same work

- Specs 9140c692, e04cfdcb, be799808 contradict the decision — closed.
- `modules/liveRule.ts` (bench) takes the assembled inspection through `tagma op`; the synthetic half stays.
- App: the module card shows root, entries, edges both ways, floors inside, children as layers; edges lead to cards.

## Done when

- Before the move, verdicts of 7 enforced rules are lifted: 083d37f1, f49f228f, 94d54cd1, fd247128, 39817e41, 0d2c66a9, 6b3210c7. After: 083d37f1 — same debt of 5 and 0 new violations, including `order`; 0d2c66a9 and 6b3210c7 — same debt.
- Probes refuse and roll back: a new folder under `apps/tagma/server/src` — `uncovered`; an import bottom-up between server children — refused; a file on agent's lower floor importing a new `src/` file — refused.
- `set_module` with an edge opening a violation refuses with `debt-grows`; with `absorb`+`owners` it passes and writes debt.
- `update_block` on a #module root refuses and names `set_module`.
- No enforcement document holds a module map; `boundaries`, `direction`, and `tightens` are gone from the code.
- A server rule does not reach the agent in `apps/tagma/inspection`.
- Server, inspection, and app typecheck clean; tests are contracts only: map assembly from cards, the `set_module` gate, `order` semantics, rule reach.
