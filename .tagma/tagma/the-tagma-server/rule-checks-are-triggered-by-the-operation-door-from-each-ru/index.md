---
id: 01a0d930-0464-7e6f-bf08-b277b9bdfa95
title: Rule checks are triggered by the operation door from each rule's own setting, run through one `check` command, carry no enforcement budgets, and read code through per-language adapters
ord: 44
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Amended by the operator's word, 2026-09-27 (section 3 §3.12, [[511b13e3]]):** no per-rule budget setting returns, but every inspection ask and every wait has a derived ceiling with an absolute cap — a builtin ask at most 120 s (min(10 s + per-builtin cost × subject, 120 s)), a program without command rules 10× its recent p95 clamped to 60 s–15 min; hitting a ceiling cancels the ask and answers "not judged: ceiling exceeded" (a refusal at gate, `unjudged` at watch), is never written into debt, and leaves a stall record naming the owner. Where this text says time is bounded by command rules only, §3.12 governs.

The operator's word, 2026-09-25. The engine built in [[be584b76]], [[50467aad]] and the engine sections of [[8e7c936b]] is reworked to meet four requirements:
- nothing is on by default, and everything is configured;
- no command knows about checks;
- the engine keeps no limits of its own;
- no language is hard-coded into a layer named for no language.

## 1. Observable outcome

- A `#rule` carries an optional check setting:
  - the inspection and its parameters;
  - its triggers — which operations, before or after;
  - its strictness — note, watch or gate;
  - its debt.

  A rule with no setting is text, and nothing runs.
- Two commands:
  - **`check`** runs rules and changes nothing. Input:
    - `rules`: some rules or all of them;
    - `over`: the caller's change or the whole repository;
    - `inspection`: optionally, an inspection not yet saved, to see what it would find.

    It replaces `try_inspection` and `inspect_work`, including `layers`.
  - **`enforce_rule`** writes a rule's setting. At enablement it measures the whole reach and records what it finds as owned debt. A loosening asks, as today.
- **Triggers are data.** A rule names the operations it runs at, e.g. `on: [{ op: 'submit_work', phase: 'before' }, { op: 'edit', phase: 'after' }]`, empty by default.
  - A before-trigger may refuse the operation, at gate.
  - An after-trigger only reports and records escapes, at watch.
- **The operation door runs triggers.** Every operation passes through one door. It runs the rules whose trigger matches, with the subject that operation declares. `submit_work`, the worktree merge, `edit` and every other body contain no call to a judge.
- **No enforcement budgets.**
  - Builtins must be fast enough to need none.
  - A program is an ordinary command on the execution host, bounded by the project's command rules like any command.

## 2. Problem, with evidence

- **Two call sites.** `harness/submitWork.ts#commitOwn` and `working/WorktreeFinishing.ts` call the `LandingJudge` port. The run points are the fixed enum `at: landing | merge | work`, so a project cannot hang a check on any other act.
- **Duplicated limits.** The `enforcement.landingBudget` and `enforcement.mergeBudget` settings, the `landing-budget` refusal and the deadlines derived from them duplicate the command rules the execution host already applies.
- **Hidden language.** `packages/code-facts` presents itself as language-neutral, but:
  - `imports.ts` parses with the TypeScript compiler;
  - `workspace.ts` reads npm `package.json` workspaces and `exports`;
  - `tree.ts` resolves by JS rules.

  Nothing in a path or name says JS.
- **Slow builtins.** `direction` over the server's 850 files takes about 0.5 s.
- **Two dry-run doors.** `try_inspection` and `inspect_work` answer one need.

## 3. What holds now

- Area [[805446cf]]:
  - workers, `enforce_rule`, the gates at landing and merge, `inspect_work`, the re-measure driver, command inspections, `at: work`.
- Two rules are enforced at gate at landing: [[f49f228f]] (floors, `direction`) and [[0d2c66a9]] (`loads`).
- The layer rules are not enforced yet (task b7092dd4).

## 4. Target model

### Rule setting

The enforcement document replaces `at` with `on: Trigger[]`, where `Trigger = { op: OperationId, phase: 'before' | 'after' }`. Strictness applies per phase:
- gate refuses only in `before`;
- in `after`, gate acts as watch.

The existing documents migrate:
- `at: landing` → before `submit_work` and before `merge_worktree`;
- `at: merge` → before `merge_worktree`;
- `at: work` → after `submit_work` and after `merge_worktree`.

### Subjects

An operation that a trigger may name declares what it gives a check:
- the changed paths;
- the tree judged and its base, when it has one;
- the per-line authorship from the change record;
- the caller.

`submit_work` and `merge_worktree` give the built tree against its base. `edit` and `write` give the file's new text against its committed text. An operation that changes nothing gives the checkout at HEAD. Declaring a subject is part of the operation's declaration in the catalog, not code in its body.

### Door

The native operation door, the one place every operation passes:
- before the body, runs the matching before-triggers and refuses `rule-violated` or `inspection-failed` at gate;
- after the body commits, hands the matching after-triggers to the background runner, the re-measure driver generalised off every permit.

A rule the door cannot judge because the subject is missing refuses at gate and is named `unjudged` at watch.

The verdict is unchanged:
- **new** is the built side minus the base side minus the debt;
- a crossing on a live peer's line is carried, recorded as an escape, and told to its holder;
- an escape excuses nothing.

### Commands

**`check`** answers `{ violations, fingerprints, unjudged, rules: [{ rule, ms }] }`.
- With no `inspection`, it runs the named or all enforced rules, whatever their triggers and strictness.
- With `inspection`, it runs that setting over a rule's reach (`blockId`) or the whole project.
- `over: 'change'` uses the caller's uncommitted change and its authorship. `over: 'all'` uses HEAD.
- A program asks `execute`.

**`enforce_rule`** keeps its contract, with `on` in place of `at`, and without the budget refusals.

### Languages

`@runlith/code-facts` splits into two parts.
- **A neutral core:**
  - the tree port;
  - blob reads;
  - file-to-file edges;
  - floors;
  - memoisation by blob id.
- **Language adapters:**
  - under `packages/code-facts/src/languages/<language>/`;
  - each implements one port: `{ id, parses(path), imports(text, path, reads), resolve(specifier, from, tree) }`, plus an optional workspace reader;
  - `languages/js` holds today's TS parsing, the Svelte script cut, the JS resolution rules and the npm workspace reader.

A builtin declares its languages:
- `direction` works for any language with an adapter;
- `loads` works for JS only, since it follows npm `exports`.

`read_inspections` answers both lists: the adapters, and each builtin's languages. Adding a language is a new adapter, with no change to the core or to the builtins.

### Speed

The JS adapter parses with `oxc-parser`, a native binding, instead of the TypeScript compiler. A target, checked by a benchmark committed with the adapter:
- the whole runlith server under `direction` in under 100 ms warm;
- a landing touching a few files in single-digit milliseconds.

## 5. Owners and boundaries

- **The server's operation door** owns the triggers. It is the native operation binding, where refusals are already raised.
- **`enforcement/`** owns:
  - judging a subject;
  - the background runner;
  - `check`;
  - `enforce_rule`.

  It declares a port the door calls, so the door never imports `enforcement/`'s workers.
- **`protocol/`** holds the trigger and subject schemas.
- **`@runlith/code-facts`** owns the neutral core and the adapters.
- **`@tagma/inspection`** owns the builtins and their language declarations.

## 6. Rejected alternatives

- **Keeping the judge calls in `submit_work` and the merge, and adding more call sites.** Every new trigger would be another hand-wired body.
- **Per-rule time budgets.** The execution host already bounds commands, and builtins that need a budget are too slow.
- **One `lang` field on the builtin with no adapter port.** It hides the language but still hard-codes it.

## 7. Acceptance criteria

- No file under `harness/` or `working/` imports a judge or a landing-judge port. A grep for `LandingJudge` finds only its removal.
- A rule with `on: [{ op: 'edit', phase: 'after' }]` in a fixture reports a crossing after an `edit` that adds it. The same rule with `phase: 'before'` on `submit_work` at gate refuses the landing. A rule with empty `on` runs only through `check`.
- The enforced documents of [[f49f228f]] and [[0d2c66a9]] decode after the migration with the triggers listed in §4.
- No setting named `enforcement.*Budget` exists, and no refusal `landing-budget` exists. A program inspection is stopped by the project's command rule, and nothing else.
- `check` covers every case that `try_inspection` and `inspect_work` covered, and both of those ids are gone from the catalog, the doors, `.agents/*.md` and the tests.
- `packages/code-facts/src` has no `typescript` or npm-specific import outside `languages/js/`. A test adapter for a toy language drives `direction` in a fixture with no change to the core.
- The committed benchmark meets the speed targets on this machine, and the measured figures are named in the close.

## 8. What becomes of each claim and task it touches

- The claims under [[805446cf]] about landing and merge gates, budgets, `at`, `inspect_work` and `try_inspection` are rewritten from the code or superseded.
- The kit claims of `@runlith/code-facts` and `@tagma/inspection` move with the files: `reanchor_path`.
- **Task b7092dd4.** Enforcing runlith's test layers waits on this rework. The layer rules are enforced on the new triggers after it.

## 9. Order of building

1. The language split, with the JS adapter on TypeScript. Behaviour is unchanged.
2. `oxc-parser` in the JS adapter, with the benchmark.
3. The budgets removed.
4. Triggers and subjects in `protocol/`, the door, and the migration of `at`.
5. `check` replaces `try_inspection` and `inspect_work`.
6. The judge calls removed from `submit_work` and the merge.

Steps 1–2 and steps 3–6 touch disjoint files and may be built in parallel.

## Spec list

- 10 Contract: the enforcement document stays at version 1, and `at` is read as `on` on decode. Operation ids change: `try_inspection` and `inspect_work` go, `check` comes.
- 11 Stored data: the two enforced documents are rewritten by migration. An old server cannot read `on`, so a downgrade is unsupported, as with `work`.
- 12 Who may do what: unchanged. A loosening and naming a program ask under trust.
- 13–14 Long-lived things and bounded resources: the workers and the warm tree are unchanged. Time is bounded by the command rules only.
- 15 Rollout: nothing runs where no rule is enforced.
- 16 Failures: a refusal raised before the body leaves the operation unrun.
- 17 Observability: each trigger run records a span named for its operation and phase.
