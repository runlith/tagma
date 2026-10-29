---
id: 01a0f4ab-e2f0-7606-910e-f31b53727148
title: Adoption records and the trusted predecessor with pending states, dormant until the trust root, and the `AdoptedLaw` port filled
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4c0-e273-7359-bc59-926487eca0c6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0506-7364-9447-e291172759d0
---
Release N (order A of [[9140c692]]). Build adoption records and the trusted predecessor with pending states as code that stays dormant until the trust root: with no adoption recorded, every checkout reads `unadopted` and judges exactly as today. Fill the graph's `AdoptedLaw` port ([[172759d0]] §4.1–4.2).

**Class:** most complex — `claude-opus-5-5` xhigh.

**Target:**
- An adoption record per rule and checkout: the policy digest over the decoded policy in canonical form; the reach identity (region id and the minimal source-prefix set within the base, region and every live descendant — [[feab0c98]]); the checker identity digest (empty until [[b2965d21]]); the pinned `{ vocabulary: TagTable.revision(), projection: LawProjection }`; the measured revision. Kept in `enforcement/`'s own store and the journal; written only by later acts (the trust-root act and `enforce_rule` from release N+1) — this task writes records only in tests.
- The judgement fixes the predecessor's accepted rules before reading the candidate and enumerates them; a candidate whose policy, reach, checker or projection differs is `pending` and governs nothing; a deleted, disabled, moved or narrowed rule is caught against the enumeration; when the vocabulary revision differs, the predecessor keeps judging under its pinned projection and the candidate is pending; an uninterpretable pinned projection fails the inspection.
- `AdoptedLaw.on(projectId, identities, typeIds)` takes the caller's immutable `TypeIdentities` snapshot; `adoptedOn` in the predicate module resolves both requested and adopted type refs only through `resolveStoredType`, unknown fails `AdoptedLawUnread`, and the filler is bound in composition. Graph owns `LawField.behaviour` schema/legacy decoding/`projectLaw` and all graph callers (tag-contracts); enforcement owns record consumption and acceptance compatibility (law-adoption). Do not claim full runtime readiness.
- `read_inspections` and `check_rules` show `accepted`, `pending` or `unadopted` per rule.
- Fill `AdoptedLaw.hold(projectId, revision, act)` in release N with the same permit that `AcceptedLaw.accept` takes. Read and pin the revision atomically; a mismatch fails before `act`, which runs exactly once. Release on failure and interruption; refuse re-entry; acquire GLOBAL/project in one declared order. Declare the resource rank under [[511b13e3]] before wiring; acceptance never waits for this permit while holding a writer or graph lock. Exercise these contracts through the public owner, including acceptance blocked during `act`. The graph owns the generic port and `AdoptedLawMoved`; enforcement owns its implementation.

**File scope:** a new `apps/tagma/server/src/enforcement/adoption/**`; `enforcement/judging/judge.ts` (`inPlay`); `enforcement/rules/{predicate,reads,reach}.ts`; `enforcement/contract/**`; the enforcement store; the one binding of `AdoptedLaw` in `apps/tagma/server/src/composition/` — coordinate that line with the composition wave's owner only if the same lines move.

**Acceptance:** [[172759d0]] §7, all but the fresh-clone item (which needs `tagma check`'s base revision) — each as a fixture test with an adoption recorded in the test; plus: with no adoption recorded, runlith's 13 rules judge exactly as before (`check_rules over: all`).

**Builds on:** the codec 3a356311ce (task cec43670: `enforcement/contract/wire/document.ts`, `readLaw`, version 2 envelope with an opaque `adoption`), the predicate module 57e9953a03 (task 2947c38b), and the tags lead's 4f0630b782 (`TagTable.revision()`, `LawProjection`, the `AdoptedLaw` port declaration).

**Reviewers:** Muse lenses — concurrency and races; stored data and restart; `claude-opus-5-5` xhigh; `gpt-6-astra` xhigh (law-astra).
