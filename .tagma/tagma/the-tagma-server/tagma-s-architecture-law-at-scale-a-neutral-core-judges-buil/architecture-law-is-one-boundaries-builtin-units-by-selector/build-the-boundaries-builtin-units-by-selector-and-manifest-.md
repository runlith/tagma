---
id: 01a0f502-645d-7353-aede-ae1010a06ac0
title: "Build the `boundaries` builtin: units by selector and manifest, floors at birth by category, ordered entries, prohibitions and cycles on real imports"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f502-a804-7296-8f0b-ab59c01d62b9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04fc-7cb9-bf49-deb7bedb212a
sources:
  - kind: dir
    ref: apps/tagma/inspection/src/packs/architecture/boundaries
---
Build the `boundaries` builtin as [[bedb212a]] §4.1 states it — units by ordered selectors and workspace manifests, floors by unit or category assigned at birth, a declared `unplaced`, `inner` order inside one unit, ordered first-match entries (a target no entry matches is private where entries are declared), `declared: manifest`, `manifest: exports`, prohibitions, cycles measured on real imports between units, `coverage`, `unresolved: refuse | unjudged`, and the closed `relations` list as an opt-in mode. It changes no law in force: no rule carries it until the conversions of [[cdf2a89f]].

**Class:** most complex — `claude-opus-5-5` xhigh.

**Target:** the schema and its decoding refusals (two selectors producing one unit id, an empty capture, a unit or category on two floors, two entries with one pattern and different roles); the reading over `@runlith/code-facts` (imports, resolution, workspace manifests — today's `direction` and `modules` readers are the reference); fingerprints — a floor crossing keeps `<file> -> <entry>` ([[b0921843]]), an entry or prohibition violation `<file> -> <target unit>:<entry or prohibition>`, a cycle the sorted unit set with the file that closes it; `tightens` proofs as §4.1 states (moving a `top` unit onto a floor, removing a prohibition or widening an entry asks; a proven floor move under `siblings: allow`, adding a prohibition or entry restriction writes); declared limitations and unblock words; registration in the `repository` pack.

**File scope:** a new `apps/tagma/inspection/src/packs/repository/boundaries/**`; the pack's `manifest.ts` and `implementations.ts`; `packages/code-facts/src/**` only for a neutral `manifests` door if the reading needs one.

**Acceptance:**
- §7 of [[bedb212a]] for the builtin itself: in a fixture, a new feature under an existing category, a new unit matching a selector and a new package produce no violation and need no policy change; an upward import and a cycle between sibling units (from real imports) are violations; the decoding refusals hold; `unplaced: out` is reported uncovered; `unresolved: refuse` makes an import aiming inside the region at a missing path a violation.
- Parity: `boundaries` with the policies of [[f49f228f]], [[94d54cd1]], [[39817e41]] and [[fd247128]] (their floors as `boundaries` floors) reproduces their verdicts and fingerprints at HEAD.
- Typecheck; tests (at most 3 workers).

**Not here:** reverse impact (its own task), the conversions of 083d37f1 and the `direction` rules (operator's word), removing `direction`/`modules`.

**Reviewers:** Muse lenses (decoding and precedence; tightening proofs), `claude-opus-5-5` xhigh, `gpt-6-astra` xhigh (law-astra).

## Deviations and open points (law-boundaries)
- Delivered so far in commits 3f31cecf44, 0b86411cd1, c9228cc2c7, ebedd456f5, a3399f1baf, ab4556b2b3; the task stays in_work for a targeted re-review.
- Parity with [[f49f228f]] at HEAD: verdicts and fingerprints equal (0 violations both sides); of 2601 probe pairs, 2 differ by design of [[bedb212a]] §4.1 — an import between `native-harness` and `external-harnesses` landing on the other unit's `contract/wire/`: `direction` lets it pass as same-floor siblings, `boundaries` judges it by the floors with `siblings: cross` whatever the inner order. Kept for the conversion delta of [[cdf2a89f]], not patched. [[94d54cd1]], [[39817e41]], [[fd247128]]: equal, 0 matrix differences.
- A unit id two selectors produce is refused at decoding only when the second selector is fully captured by an earlier one; a collision that depends on the tree (two selectors capturing the same id in different places) cannot be seen from params, so a reading that reaches a file of the later place fails, naming both places, and is never a violation or debt (e138dcd6e8, delta [[bc552dd4]]).
- Visibility gap, closed: the js adapter now resolves tsconfig `paths`/`baseUrl` and the importer's package `imports`, and names an undeclared bare specifier unlisted, so `unresolved` judges it ([[2497084b]], delta [[901a47ad]] closed into [[4117f747]], [[3092f489]]); no heuristic in `boundaries`, limitation restated in 12f49e447c.
- Reverse impact ([[bedb212a]] §4.5) is not built: a manifest, `exports` or resolver change that makes an unchanged importer cross is found at the next whole-reach measurement ([[550755a6]]).
- Coverage is now observable: each file of an `unplaced: out` unit is named `uncovered` in the reading, the verdict, `check_rules` and the CLI; `read_inspections` lays out each enforced `boundaries` rule's units (selector, floor) and uncovered files at HEAD through one reach-worker ask, capped per rule with totals.
- Envelope: `boundaries` is calibrated per machine (no static file count); cycle search reads each reached unit's files once, charged to the envelope, strongly connected units found once per reading, the shortest cycle searched only inside the importer's set once per target unit. One sample (load ~10): a one-file landing in the server region with `cycles: refuse` read in 0.64–0.76 s, down from 1.63 s.
