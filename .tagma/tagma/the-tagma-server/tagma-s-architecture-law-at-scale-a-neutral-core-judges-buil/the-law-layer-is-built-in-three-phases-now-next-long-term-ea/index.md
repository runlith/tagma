---
id: 01a0f476-052f-72dc-811f-f2468fe9d0a8
title: The law layer is built in three phases — now, next, long-term — each bringing the prerequisites of what it promises and ending at stated acceptance
ord: 10
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Its accepted-law, trusted-checker and suppression criteria are withdrawn by [[16819c00]].

Part of [[9140c692]]. It fixes the order in which the law layer is built and what proves each phase done. Each phase brings in every prerequisite of the outcomes it promises; nothing is promised by a phase that lacks its prerequisite.

## 1. Outcome

Three phases — now (weeks), next, long-term — each ending at the acceptance below.

## 2. Problem, with evidence

The layer grew in five days as one builtin per decision ([[9140c692]] M4, M5); without a stated order its parts would again be built before what makes them sound — a grouped linter run before checker identity, a tree runner before its base cache.

## 3. What holds now

The builtins, program contract 1, enforcement document version 1 and the 13 enforced rules of [[cdf2a89f]] §3.

## 4. Target model

**Now (weeks)** — [[cdf2a89f]] steps 1–7, in the one order with the tag model that [[9140c692]] states (A release N, B release N+1 and the trust root, C in parallel):
- release N, readers and refusals: the version 2 codec as a reader, the refusal to write over a newer version, the predicate module, adoption and the trusted predecessor with pending states, the publication re-check, beside the tag model's format marker; release N+1: the migration trust-root act, the first version 2 write ([[172759d0]]);
- contract 2 with binding keys, counts, values for every road, and grouping ([[d11108eb]]);
- declared checker identity and prepared environments ([[b2965d21]]);
- the runlith program replacing three builtins; `size`; the removals, the `tagma` pack before the tag model's `tagma` library; the `oxlint` adapter with conformance.

**Next:**
- `boundaries` with selectors, category floors, entries, prohibitions, cycles on imports, and reverse impact ([[bedb212a]]);
- the [[083d37f1]] conversion and the fold of the four `direction` rules;
- runlith's per-file rules onto oxlint and ESLint with Svelte;
- the facts snapshot and the Python adapter ([[3f3fe425]]);
- the `ruff`, `ast-grep` and `semgrep` adapters with conformance.

**Long-term:**
- `tree` adapters (golangci-lint, clippy, ESLint with types) together with the complete base cache; a cold base stays an explicit preparation;
- third-party packs as manifests with files on the caller's road; a paged ledger; `tagma check` without a running server, and an export of accepted law for stealth projects in CI;
- a query channel for facts.

## 5. Owners and boundaries

As in [[fd53d2cb]].

## 6. Rejected alternatives

- **The `boundaries` conversion first**: it is the largest change of law and needs adoption, the semantic delta and reverse impact under it.
- **All adapters at once**: each needs its conformance suite before it may gate.

## 7. Acceptance criteria

**Now:**
- The source audit and the two unrelated-project fixtures of [[fd53d2cb]] §7 pass; `catalogOf` composes no `effect` or `tagma` pack.
- A rule referencing a fixture's oxlint plugin rule is adopted and judges with no Tagma release.
- Ten #rules on one descriptor judge with one oxlint process for both sides, shown in the span.
- An unlanded plugin edit and a changed `node_modules` package leave the verdict unchanged and the rule pending; an unpreparable environment refuses `inspection-failed`.
- A governed violation under an `oxlint-disable` comment, old or new, is not hidden.
- A policy edit, a deleted or moved #rule in `.tagma` does not govern the change that carries it.
- The duplicate and value cases of [[d11108eb]] §7 hold.
- The runlith program's verdicts equal the three builtins' on HEAD and the mutation corpus; `size` equals [[6b3210c7]]'s adopted ledger.
- A one-file landing in runlith costs no more work than today: compared by stage timings and work counters, one machine's milliseconds taken as a sample, never a guarantee.

**Next:**
- In a fixture, a new feature, a new unit by category and a new package land with zero policy writes; an upward import and a sibling cycle refuse.
- A change to `exports`, a deleted target or a shadowing file refuses at an unchanged importer; the incremental reading equals the full reading on fixtures; losing the index changes latency only.
- [[083d37f1]] is replaced: no relation list and no copied package entries remain in any policy; the grouped delta was approved once.
- runlith's per-file rules run on oxlint and ESLint with Svelte at parity.
- The Python adapter judges `boundaries` over a fixture service; the new adapters pass conformance.

**Long-term:**
- 500,000 lines added across many new features grow facts and the work a landing touches, not policy rows.
- Queues, memory and disk stay within their owners' budgets across many projects; a cold large run answers not-ready or failed, never a frozen server or a false clean.

## 8. What becomes of the claims and tasks it touches

None beyond the children's; no task is opened before the operator accepts [[9140c692]].

## 9. Order of building

§4.

## Spec-list questions

This decision answers 1–9 and 15.
- 15 Rollout: each phase lands behind adoption; rules keep judging under their version until re-adopted.
- out: 10–14, 16, 17 — each is the child's that builds the part: [[d11108eb]], [[b2965d21]], [[172759d0]], [[bedb212a]], [[3f3fe425]].
