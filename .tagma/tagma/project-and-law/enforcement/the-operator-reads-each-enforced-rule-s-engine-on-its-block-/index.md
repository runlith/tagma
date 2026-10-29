---
id: 01a0f7ec-23e0-7536-8498-9e02dae3af36
title: The operator reads each enforced rule's engine on its block page and the project's whole law on a Law surface, from one read_enforcement operation and a refusal record enforcement keeps
ord: 14
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Approved by the operator on 2026-10-01 from the mock at http://localhost:5634/a/2a73eae8ce7c ("go ahead and follow your own plan" (translated from Russian)), relayed by law-opus. Designed and built by rules-ux.

## 1. Outcome

- A #rule's block page shows, under its body, the rule's **engine**: how strict it is and which acts run it, what checks it and what that means, its parameters drawn in their own shape (floors bottom-up, thresholds, modules and their relations, lists), its debt grouped by the work that owns it with the trend of its count, the acts it refused, what slipped past it, and its law standing — accepted, pending with the reason, or not adopted — with when it was last measured and who changed it last.
- A **Law** surface shows every enforced rule of the project on one screen: what it guards, where, how strict, what checks it, its debt and trend, its last refusal; and how many rules carry no check.
- Every refused landing, merge and checkout commit is recorded per crossing — rule, file, line, what it reached, the base commit, the caller, the time — kept by enforcement in a bounded, pruned table and read page by page.
- Nothing on either screen asks for permission or offers a control that only enables another ([[0f144655]]); a rule is changed by asking an agent, which acts through `enforce_rule`.

## 2. Problem, with evidence

- The operator's words: "there are rules, they have some automatic checks, and we do not even see that they exist". Today the block page shows a rule's title and body; its enforcement document is a raw field read only through `read_block` or `read_inspections`.
- `read_inspections` answers 289,535 characters for runlith (2026-10-01): the builtin catalog with JSON Schemas, every enforced rule's raw inspection, 126 KB for [[083d37f1]] alone. It is an agent's setup reading, not a screen.
- No refusal is recorded anywhere: `enforcement/commits.jsonl` is the commit queue; escapes are recorded, refusals are seen only by the agent that met them (the two refusals of 2026-10-01 ~15:50 and ~15:57 survive only in thread traces).
- Debt movement is invisible although the journal holds it: an `enforce` act carries `debtBefore`/`debtAfter`, a `remeasure` act carries `retired` ([[6b3210c7]] went 36 → 34 between 2026-09-30 and 2026-10-01; [[083d37f1]] went 3 → 5).
- `read_block_diff` over [[6b3210c7]] refused `journal-unreadable`: event 83348 is a `link` act written as `{"kind":"implements"}` without `toId`, and the graph's link payload reader requires it. The fix belongs to the graph's journal reader; another session holds that change uncommitted in `graph/contract/wire/journalPayloads.ts` and `graph/blocks/history.ts` while this is written.

## 3. What holds now

- `governingRules` answers each enforced rule with its document, its standing (`accepted`, `pending`, `unadopted`), the pending reason and its reach; `measuredRules` turns that into `read_inspections`' `measured` rows.
- The rule-check port (`RuleChecks.before`) judges `submit_work` and `merge_worktree` trees, `commit_checkout` and `git_commit` staged indexes, and changeless operations at HEAD; a `rule-violated` refusal carries the crossings in `crossed`.
- Builtin declarations carry `describe` and `tightens`; nothing declares how a surface draws their parameters.
- `BlockPage.svelte` stands in [[6b3210c7]]'s debt at 731 lines and may not grow.
- The app is English throughout; the operator's mock was Russian because the conversation was.

## 4. Target model

### 4.1 One read: `read_enforcement`

Owned by enforcement, beside `read_inspections`, answering the HTTP door and agents. Input: `rule?` (a #rule), `focus?` (a unit of the rule's modules shape), `limit?`, `cursor?`.

- **No `rule`: the project's law.** `law` — `unadopted`, or `adopted` with its branch, revision and acceptance time; counts of law-bearing rules, enforced rules by strictness, and debt entries; and a page of **rule rows**.
- **With `rule`: one rule's engine.** Its row, its `shape`, its `history`, its `law`, and the first page of each list — `debt`, `refusals`, `escaped`, and `units` where the shape has units — each `{ rows, total, next }`.
- **With `cursor`:** the next page of the list that minted it, under the same question; a cursor from another rule, list, revision or HEAD refuses `cursor-stale`.

A **rule row**: name, title, `places` (its reach under the inspection's base), `strictness`, `on`, `checker` (`builtin` with its id and concern, `program` with argv, reach and format, `runners` with their checks, or `unread` with the reason), `standing` with `pending`, whether it governs, `debt` `{ count, was }` where `was` is the last count that differed and when, `escaped` count, `refused` (the newest refusal: when, file, line, act) and `measured` `{ ms, at }`.

### 4.2 Where each field comes from

| Field | Source |
|---|---|
| strictness, triggers, check, debt, escapes, baseline, measured | the governing document — the accepted record on an adopted branch, the graph document otherwise (`governingRules`) |
| places | the rule's reach under the inspection's base (`reach`) |
| standing, pending | `governingRules`, and a checker drift as `read_inspections` reads it |
| shape | the builtin's own `shows(params)` in its pack declaration; a program's command; a runner binding's checks |
| debt owners | each owner block's title and status |
| history, `was` | the rule block's `enforce` (`debtBefore`, `debtAfter`) and `remeasure` (`retired`) journal acts, counted back from the current debt |
| last change | the newest `enforce` or `remeasure` act of the rule: its time and session |
| refusals | the refusal record (4.4) |
| project law | the accepted-law lines and the `law_accepted` row |

### 4.3 Shapes are declared by the builtins

`@tagma/inspection` core declares a `Shape` vocabulary — `floors` (bottom first, with whether siblings cross), `thresholds` (glob, metric, ceiling), `modules` (each module's territory and entries, and the relations), `lists` (labelled lists) — and a `Concern` each builtin names: `imports`, `loading`, `code` or `size`. Each builtin declares `shows(params): Shape` and its concern in its own declaration; the engine and the surface take every decision off the shape kind, never off a builtin id. A shape is bounded by construction: a builtin that holds per-site allowances shows counts, never the sites. For a `modules` shape the read answers each module's counts as `units` and one module's neighbourhood — what it may import and who may import it — for `focus`.

### 4.4 The refusal record

- A machine-store table `rule_refusal`, owned by enforcement, one row per crossing of a refused act: project, rule, act, file, line, fingerprint, what it reached (specifier or message, at most 300 characters), base commit, branch, the caller as an actor reference, time.
- Written by the rule-check port when a `before` judgement of a tree (`submit_work`, `merge_worktree`) or of `commit_checkout`'s index refuses `rule-violated`. `git_commit` records nothing: that judgement is `check_rules` `over: "staged"`, which records nothing by contract, and a person's hook refusal stays in their terminal. Changeless operations judged at HEAD record nothing: they are refused for the state of HEAD, not for a change.
- A write the store cannot keep does not change the refusal; the refusal's reason says the record could not be kept and why.
- Bounded: at most 2,000 rows and 90 days per project, pruned in the same write; a removed project's rows go by cascade. 2,000 rows is under 1 MB per project and covers months of refusals at the rates seen (two a day); a refusal older than a quarter informs nothing on a screen of recent acts.

### 4.5 The surface

- **Law** joins the knowledge navigation beside Map and Graph: the project's law line, the counts, and the rule rows grouped by concern, each opening the rule's block page; rules without a check are one line.
- **The engine** renders on a #rule's block page under its body, through a block-facts component that also carries the reflection facts, so `BlockPage.svelte` shrinks. It reads `read_enforcement` with the rule, re-reads when the block changes, and draws: the law line (refused just now, debt growing, pending, accepted, not adopted, slipped past), strictness as a three-step scale with the triggers in words, the checker with one line of what that kind of checker means, the shape, the debt by owner with the trend, the refusals, the escapes and the law with its last change. Phrases name the act: "Change it by asking an agent — it calls enforce_rule".
- English, as the rest of the app. Animations run unconditionally ([[77135f8f]]).

## 5. Owners and boundaries

- Enforcement: `read_enforcement`, its page families and voice, the refusal record and its table, reading the graph journal through `GraphJournal`.
- Inspection: the `Shape` and `Concern` vocabulary in `core`, each builtin's `shows` and concern in its pack declaration.
- The surface: the Law surface and its route, the engine and block-facts components, a repo reading `read_enforcement`.
- The graph: the link payload reader that accepts an act stored without `toId` (the session holding it lands it; this decision only depends on the history it reads).

## 6. Rejected alternatives

- **Extending `read_inspections`**: it is the agent's catalog of builtins and schemas; a screen would pay 289 KB per read for fields it never shows.
- **A debt-history table**: the journal already holds every debt movement since enforcement began, so a new table would start empty and duplicate it.
- **Refusals as graph acts**: every refused landing would write the shared graph and its files; the ledger in the graph is for what stands, and a refusal changes nothing that stands.
- **A switch over builtin ids in enforcement or the app** to draw parameters: a central list of other modules' parts ([[edea5454]]) and technology knowledge outside its pack ([[6f758080]]).
- **A Russian surface**: the product speaks English everywhere; localization is its own decision.

## 7. Acceptance criteria

- `read_enforcement` without a rule answers runlith's 13 enforced rules with strictness, triggers, checker, debt count and `was`, standing, measured time and newest refusal, and the count of law-bearing rules; it answers in pages under `limit`, with the total.
- With [[f49f228f]] it answers a `floors` shape of 49 floors bottom first; with [[6b3210c7]] a `thresholds` shape of 650 non-import lines and 34 debt entries with owner titles; with [[083d37f1]] a `modules` shape with 69 units and a focus neighbourhood; with [[99b5c911]] a `program` checker.
- A refused `submit_work` writes one refusal row per crossing, `read_enforcement` answers it newest first, and the 2,001st row of a project prunes the oldest; a refusal whose record cannot be kept still refuses and names that.
- The Law surface and the engine render every state: not adopted, accepted, pending, debt growing and shrinking, refused just now, slipped past; `BlockPage.svelte` does not grow.
- Contract tests for the operation and the record pass; the server and app typecheck; independent review findings that hold are fixed.

## 8. What becomes of the claims and tasks it touches

- Area [[805446cf]] gains claims on `read_enforcement`; [[92d5b4e2]] gains the refusal record's claims; [[506295c4]] gains a claim on `shows` and concerns.
- The surface's block page area [[ebc1d3d8]] gains the engine's claims; a new area under [[cc59eadf]] holds the Law surface.
- Rules [[6b3210c7]] and [[083d37f1]] are not changed; new files stay within their entries and ceiling.

## 9. Order of building

1. Inspection: `Shape`, `Concern`, `shows` in every builtin.
2. Enforcement: the table and migration, the record written by the port, `read_enforcement` with its pages and voice, contract tests.
3. Surface: repo, Law surface, engine and block facts.
4. Claims, review, fixes, showcase.

## Spec-list questions

1–9: §1–§9.
- 10 Contract: a new operation; nothing existing changes shape. Its answer is versioned by the catalog like every operation.
- 11 Stored data: one new machine-store table by a drizzle migration; no existing row is read differently; a rollback leaves the table unread.
- 12 Who may do what: `read_enforcement` is a read for any audience, as `read_inspections`; the record is written only by the port, never by a caller.
- 13 Long-lived things: the record's rows, pruned by count and age in each write and by cascade with the project.
- 14 Bounded resources: rows per page by derived families; 2,000 rows and 90 days per project; the journal read for history takes at most 40 acts per rule.
- 15 Rollout: the operation and the record start working when the operator restarts the server on the new binary; the app's Law surface answers `not-found` from an older server and says the server is older.
- 16 Failures: a record write that fails leaves the refusal intact and says so in its reason; a journal act that does not decode ends the history at that act and the read says so; a rule whose document does not decode reads as `unread` with the reason.
- 17 Observability: each refused act's rows are readable at once through `read_enforcement`; a failed record is visible in the refusal it was meant to keep.
