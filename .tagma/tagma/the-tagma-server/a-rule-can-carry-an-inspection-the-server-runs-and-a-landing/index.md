---
id: 01a0d4db-9d42-7146-bc0f-1b06be584b76
title: "A rule can carry an inspection the server runs, and a landing or a worktree merge refuses what it newly finds — first slice: import direction"
ord: 33
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0d4db-9d34-7461-807d-8775f5648cf9
  - kind: relates
    to: 01a0d54f-98aa-710d-b3fe-bb7cae56a980
---
First slice of [[f5648cf9]]. A `#rule` may carry an inspection the server runs, a strictness, the point it runs at and a debt. A landing through `submit_work`, and a worktree merge through `merge_worktree`, refuse what an inspection at gate newly finds. One builtin inspection exists — import direction by floors — and runlith's own server floors are the first rule enforced this way.

"Inspection" names the executable part of a rule. "Check" already names the doctor's checks, the `check` source kind and `check_worktree_merge`.

## 1. Observable outcome

- `enforce_rule` puts a rule's inspection at note, watch or gate, at landing or at merge. At the first enforcement, the violations standing at HEAD become the rule's debt, and each entry has an owner.
- A landing whose built tree adds a new crossing of a gated floor table, in the session's own lines, is refused `rule-violated`, naming the rule, the file, the line and the crossing. Nothing is committed.
- A worktree merge is judged the same way, against the target branch's rules, before it commits.
- `inspect_work` answers the verdict before anything lands. `read_inspections` answers what the server offers. `try_inspection` shows what an inspection would find, and writes nothing.
- A debt entry disappears on its own once its crossing is gone. A crossing that lands outside the debt is recorded on the rule and surfaced as a finding.
- A rule at watch or gate cannot be switched off, superseded, trashed or moved out of reach except through `enforce_rule`.
- The server's floors live in a rule under [[05042d40]]. `apps/tagma/server/src/boundary.direction.ts` and the direction assertion of the server's `boundary.test.ts` are gone.

## 2. Problem, with evidence

- `submit_work` lands without judging anything. `harness/submitWork.ts#submitWork` builds a tree on a temporary index and commits it. `merge_worktree` commits outside it (`working/WorktreeFinishing.ts`, the `merge` member).
- Architectural law lives as tests nothing runs: 20 calls to `readPackageBoundary` (19 `boundary.test.ts` and one `direction.test.ts`). The repository has no CI beyond `language-maps.yml` and no git hooks.
- The server floor debt went 8 → 0 → 7 → 4 between 09-04 and 09-20 with nothing holding it. An upward import `worktrees/ → terminals/` landed in f8862fcdfa, and nothing noticed it until a session repaired it by hand in 8cc6e74d5a.
- A `#rule` is prose with an `enabled` switch. Its reach is delivered ([[994c45a7]]) and never measured.

## 3. What holds now

- `protocol/tags/shape.ts` holds:
  - ten roles, where `law` binds a field name (`#rule` binds `enabled`);
  - `OWNED_ROLES`, one owner per role;
  - field schemas, named in `FIELD_SCHEMA_NAMES` and decoded in `graph/core/Tags.ts`.

  Roles decode with excess properties refused, and schema names are a closed literal set. So a server older than a vocabulary change cannot read a declaration that uses it.
- `graph/core/Blocks.ts#assertNotOperated` refuses a hand write of status, holder and `catalog.release` with `operation-only`. `Blocks.setEnabled` switches a rule. `graph/orientation/Orientation.ts#lawForest` drops a rule that is switched off, superseded or trashed.
- `packages/package-boundary`:
  - reads only non-test `.ts`, `.tsx` and `.svelte` files;
  - `parseImports` throws `UnsupportedSource` for any other extension, and `ts.createSourceFile` tolerates syntax errors;
  - `resolveLocal` resolves against the disk, trying `.js → .ts`, `.ts`, `.tsx`, `.svelte` and `index.ts`;
  - `floorViolations` (private) applies the floor law of [[da82ae4e]], [[f52e4a92]] and [[c4a60ae4]], skipping an unresolved specifier.
- The server also has a second import reader: the regex reader of `graph/measure/imports`, which feeds `dependency-undeclared`.
- The server ships neither `typescript` nor `@runlith/package-boundary`; both are `devDependencies`. A release carries bundles, with every worker a closure entry (`install/closure.ts`, `install/release.ts`).
- `graph/measure/measure.worker.ts` shows the off-loop pattern ([[abc5bac9]]), with an inline fallback after crashes.
- A worktree is served its own graph (`http/GraphRouting.ts`, by project, cwd and branch). Landings hold a per-root permit and the carriers' run admission ([[65bc1a39]], [[5049b86d]]).
- At HEAD 6821abb7eb the server's direction crossings are exactly the four debt pairs `terminals/ → api/`, `terminals/ → http/`, `terminals/ → socket/` (one file, `terminals/pageWorld.ts`) and `harness/ → terminals/`. Test files add others, measured by both reviews.

## 4. Target model

- A rule's enforcement is one document on the rule. It holds the inspection, the strictness, the run point, the debt, the escaped crossings and the baseline. Only `enforce_rule` writes it, apart from the automatic retirement of debt ([[64798cd8]]).
- An inspection is a builtin from a typed record in `@tagma/inspection`, placed by [[ae56a980]]. Its ids and parameter schemas sit in that package's vocabulary door, and its implementation in the Node door the workers load. It reads code through `@runlith/code-facts`. The first builtin reads imports from git trees and applies a parametrised floor law, one implementation shared with `package-boundary` ([[982f1bca]]).
- A landing and a merge judge the tree they are about to commit against its base, and refuse what is new. After they land, a driver re-measures the reach, retires vanished debt and records escapes ([[f2755a5b]]).
- runlith's server floors are the first content ([[15d47c9d]]).

## 5. Owners and boundaries

- **The component map is [[ae56a980]].** This slice builds the first part of each of its three components.
- **`@runlith/code-facts` (new kit).** Import reading and resolution over a tree port, taken out of `package-boundary`, plus `floorCrossings`.
- **`@tagma/inspection` (new package).** The `direction` builtin, the judgement, and the vocabulary door.
- **`apps/tagma/server/src/enforcement/` (new).** It stands on the floor of `ai/`, `artifacts/`, `mcp/` and `skill/`, below `harness/` and `terminals/`, and holds:
  - the inspection workers that host `@tagma/inspection`;
  - the landing and merge judgement behind the port;
  - the `enforce_rule` act, the three reads and the re-measure driver.

  It brings its own Layer, and `TagmaStack` gains no owner for it. It reads rules through the graph's public owners and writes through `Act`.
- **`working/`** (floor 5) cannot import `enforcement/`. It declares a landing-judge port that `enforcement/` fills, the pattern 8cc6e74d5a used. `harness/submitWork.ts` calls the same judgement through the same port.
- **`protocol/`** holds the role, the `lawEnforcement` schema, the operations and the refusal codes. It reads the builtin ids and parameter schemas from `@tagma/inspection`'s vocabulary door.
- **`packages/package-boundary`** reads imports through `code-facts` and computes crossings with its `floorCrossings` until its direction driver dies. A kit in `packages/` never imports Tagma's packages.
- **`packages/git`** ([[adeeb4ba]]) gains a batch blob reader (`cat-file --batch`).
- **The `code-project` catalog.** `#rule` gains the `enforcement` field and role, and its guidance and prompt say what debt is.

## 6. Rejected alternatives

- **Keep checks in tests and add CI or hooks.** The law stays in two places, the graph never knows what is enforced, and every other project rebuilds `package-boundary`.
- **Encode the floor table in server code.** That is runlith's opinion inside the engine.
- **Leave a rule's switch, supersede, trash and move free while it gates.** Any ordinary write would then lift a gate with no record.
- **Debt in a table mirrored to files.** A field on the rule travels in `.tagma`, is journaled and needs no migration. A table waits until debts outgrow a document.
- **Judge the working tree.** It holds a live peer's lines that are not landing.
- **Scan the whole repository at every landing.** A local inspection needs only the changed files and their base versions. The whole reach is measured after the landing, off the permit.
- **Choose rules per changed path through `regionsOfPlace`.** It scans every source and block for each path, and misses root rules. Starting from the few enforced rules is cheaper and complete.
- **Load a project's checks into the server as in-process plugins.** A project's own inspection is a program of any language on the execution host ([[50467aad]]). Tagma's builtins are a typed `Record`, total by the compiler, like `CAPABILITIES`.
- **Widen the `law` binding instead of adding a role.** It makes the same vocabulary change, and old servers pay it the same way. A separate role keeps the `law` switch a boolean that every reader already understands.

## 7. Acceptance criteria

The criteria of [[64798cd8]], [[982f1bca]], [[f2755a5b]] and [[15d47c9d]] hold together, and in addition:
- In runlith, while the server floors rule stands at gate, a landing that adds a value import from `apps/tagma/server/src/harness/` to a file under `apps/tagma/server/src/graph/` is refused. The same import merged from a worktree cut before the rule was enforced is refused at the merge.
- A landing touching `graph/core/catalogBase.json` or a `Dockerfile` under the base is judged and lands.
- The span `submit_work.gate` records every landing's inspection time. The cost measured on runlith's landings is named in this decision's close.

## 8. Claims, rules and tasks this touches

- **Die with `boundary.direction.ts` and are rewritten over the floors rule** ([[15d47c9d]]): [[1023b406]], [[92a549da]] and [[8779de7a]]. [[92a549da]] is rewritten, not closed: a claim does not close.
- **Survive, re-read against the exported floor function:** [[da82ae4e]], [[f52e4a92]], [[c4a60ae4]], [[3f69f7f8]].
- **Survives:** [[a4d3fab9]]. `package-boundary` still depends only on the TypeScript compiler.
- **[[ef89cc03]] survives in its own region.** The enforcement debt carries its owner by the engine's own law in [[64798cd8]], not by [[ef89cc03]]'s reach.
- **Rewritten at close:**
  - [[d96eee44]]: a rule's revision covers its enforcement line;
  - [[d6835cf8]]: a third field written only by an operation;
  - [[65bc1a39]] and [[5049b86d]]: the permit now also holds the judgement.
- **Survive:** [[15263a08]], [[27244c4c]], [[2c1025df]] over `harness/submitWork.ts`. One new claim is written for where the judgement stands in the landing and the merge.
- **Honoured:** [[2a55b1e4]]. A peer's lines never hold a landing back; see how lines are attributed in [[f2755a5b]].
- **Unchanged:** [[786aef71]] and [[6b608d5d]]. A region's rule reaches a session after its first touch, so the verdict before landing is `inspect_work`.
- **Survives:** [[51fd649e]]. Browser reach is not migrated in this slice.

## 9. Order of building

[[982f1bca]] → [[64798cd8]] → [[f2755a5b]] → [[15d47c9d]]

## 10. Contract

- **Vocabulary:**
  - the role `enforcement` and the field schema `lawEnforcement`;
  - the operations `enforce_rule` (mutates) and `inspect_work`, `read_inspections`, `try_inspection` (read);
  - the refusal codes `rule-violated`, `inspection-failed`, `debt-grows`, `rule-enforced` (a gate lifted by another road), `landing-budget`;
  - the finding `rule-escaped`.
- **Receipts.** `SubmitReceipt` and the merge receipt gain `watched`, `carriedViolations` and `unjudged`.
- **Versioning.** The document carries `version: 1`. A field added later under the same version is optional; anything else raises the version, and the engine reads every version a standing rule carries.
- **Compatibility.** A rule without the document behaves exactly as today. `submit_work` and `merge_worktree` answer a new code only where a rule in reach stands at gate.

## 11. Stored data

- The document is a field in the node's JSON: no database migration.
- The `code-project` release adds the field and the role to `#rule` and rewrites its guidance and prompt. The installer upgrades projects in place ([[cfa23151]]).
- Old rows need no reading step, because a rule without the field is ungated.
- **Rollback is forward-only**, like this server's migrations: an older server refuses a database whose chain it does not know ([[bc4abc66]]), and it cannot decode the upgraded catalog.
  - A server downgrade across this release is unsupported.
  - A bad enforcement is recovered by `enforce_rule` at `off`, never by a downgrade.
  - The release notes say so.

## 12. Who may do what

- `enforce_rule` is an ordinary mutating operation with no rank gate ([[25466885]]). Its confirmation names the rule, the strictness, the run point, the debt it records and the escapes it absorbs.
- A loosening is its own permission subject, so a thread's mode can require the operator's word for it. Loosening means:
  - lower strictness, or `off`;
  - narrower parameters;
  - an absorbed escape.

  This keeps an unattended child from loosening the gate that refused it.
- The gate refuses by content, never by caller.
- **Out of this slice:** commits made by hand or by a foreign harness without a change record, `checkout_stage` with `checkout_commit`, and hand edits to `.tagma` files committed outside Tagma. The re-measure driver records a crossing any of these lands as an escape, and `tagma check` for CI and hooks is a later slice of [[f5648cf9]].

## 13. Long-lived things

- **Two inspection workers**, owned by the enforcement Layer, each with its own closure entry and no inline fallback:
  - one serves landings, merges and `inspect_work`;
  - one serves `try_inspection`, `enforce_rule` and the driver.

  A whole-reach job never queues a landing. A worker past its deadline is killed and started again.
- **The re-measure driver** runs after each landing and merge through Tagma, and at server start. It is debounced per rule and runs off every permit.
- **Parses are memoised by blob id within one landing**, across its rebuild attempts.

## 14. Bounded resources

- **Landing budget.** Every inspection at landing, together, fits a landing budget of tens of seconds, never minutes.
  - The budget is a project setting with a default of 30 seconds (the operator's word).
  - `enforce_rule` refuses `landing-budget` when the measured time of the rules at landing would exceed it.
  - At the landing, the inspections run under the remaining budget as a deadline.
- **Merge budget.** A merge has its own budget setting, measured the same way.
- **Only local inspections stand at landing.** A global one stands at watch or at merge.
- **The TypeScript compiler becomes a runtime dependency, inside the workers only.** `typescript`, `@runlith/code-facts` and `@tagma/inspection` become server `dependencies`, and the release gains the workers' closure entries and a `bundled` step. The bundle must pass the no-checkout-path check of the release; this is measured at the build.
- **Memory per worker** is measured at the build and named in the close.

## 15. Rollout

- Running threads see an enforced rule's line — strictness, run point and the inspection's own description — at the next instruction refresh ([[a71ecfc1]]). The line is part of the rule's revision.
- Landings and merges are unaffected until a rule in their reach is enforced.

## 16. Failures

- **At gate, an inspection that cannot run refuses `inspection-failed`**, naming the rule and the cause:
  - a worker past its deadline or dead after one restart;
  - a git read that failed;
  - an undecodable document, or an unknown builtin id.

  A gate that opens on failure is no gate.
- **At watch, the same failure lands** and is named in `watched`.
- **A restart mid-landing commits nothing**, because the judgement precedes `git commit`.
- **`enforce_rule` concurrent with a landing:** `enforce_rule` measures in `prepare`, then writes exactly what it confirmed, and refuses when HEAD moved in between ([[1e4a8f0d]]). A landing that races it is caught by the driver as an escape.
- **Branches.** Each worktree judges its landings by its own copy of the rules. The merge judges by the target's. Two branches that change one rule's document meet in the graph's own merge.

## 17. Observability

- The spans `submit_work.gate` and `merge_worktree.gate`, with the rules, the file count, the duration and the verdict.
- The receipts' `watched`, `carriedViolations` and `unjudged`.
- The `enforce_rule` journal entry, with the debt before and after.
- The `rule-escaped` finding.
- `read_block` on the rule shows the document.

## Coverage of the brief

The areas touched:
- [[8ec9c71c]]: delivery carries the enforcement line;
- [[4792affd]]: a role, a field schema, a catalog release;
- [[3ce532a9]]: an operation-owned field, and the gates on switch, supersede, trash and move;
- [[fe6b3580]] and [[3dbd3b23]]: four operations;
- [[12972a3b]]: the landing;
- [[af4f0ba5]]: the merge;
- [[c0f69bd1]]: the release closure;
- [[e49bba5a]]: one finding;
- [[ec2b42ac]]: two budget settings.

out: every other area under the Tagma server — this slice changes none of their code, contracts or standing docs.
