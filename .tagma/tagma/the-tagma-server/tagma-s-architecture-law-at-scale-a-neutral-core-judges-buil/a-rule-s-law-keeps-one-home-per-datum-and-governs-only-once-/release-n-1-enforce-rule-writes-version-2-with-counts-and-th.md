---
id: 01a0f4ab-e2fe-7120-a177-8469ab196d8d
title: "Release N+1: enforce_rule writes version 2 with counts, and the trust-root migration act is built but not run"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f73d-00fe-74cf-a142-bf8e25129b1b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0506-7364-9447-e291172759d0
  - kind: waits-on
    to: 01a0f4ab-e2f0-7606-910e-f31b53727148
  - kind: waits-on
    to: 01a0f4ab-e2f6-78f8-ba27-652f269a2dc5
---
Release N+1 (order B of [[9140c692]]). `enforce_rule` writes version 2 — policy, adoption record, ledger with `count` — and the trust-root migration act is built and prepared, **not run**: running it is the operator's word ([[172759d0]] spec-list 11).

**Class:** complex — `claude-opus-5-5` high.

**Target:**
- `enforce_rule` (prepare, execute, compare-and-set on the accepted revision) writes version 2 and records the adoption; a tightening core logic proves writes without asking, anything else asks.
- The trust-root act: one operation, its own permission subject (the operator's word), adopting each checkout's current rules as the accepted predecessor — the first version 2 write; before it runs, nothing changes.
- A rollback binary of release N reads what this writes and refuses to mutate it.

**File scope:** `apps/tagma/server/src/enforcement/rules/enforce.ts`, `enforcement/remeasure/**`, `enforcement/adoption/**`, enforcement's operation catalog and voice; nothing outside `enforcement/` but the operation's registration.

**Also owed here (from the reviews of 53727148):**
- every adoption act writes the evidence that adoption happened — the document's version 2 `adoption` stamp — atomically with the store record, and journals each adoption with its digests; the reader refuses when that evidence stands and the store has no line;
- a new worktree branch inherits the accepted line of the branch it was cut from, explicitly; a branch's line is dropped when the branch is deleted or archived;
- the re-measure driver measures the governing (accepted) law over the accepted reach and writes retirements, escapes and followed renames into the accepted record — never the candidate's policy;
- the trust-root act adopts every enforced rule or refuses: none is left `waiting`, and an undecodable document refuses the act;
- checker identity (b2965d21) is in place first, or the act's confirmation names the program rules it leaves unprotected.

**Also owed here (from the reviews of 269a2dc5):**
- use the acceptance/publication guard supplied in release N by [[53727148]] and [[269a2dc5]]: the graph-owned `AdoptedLaw.hold(projectId, revision, act)` is filled by enforcement and shared with `AcceptedLaw.accept`; all N+1 acceptance acts and catalog activation take that same guard, with its declared GLOBAL/project order and resource rank. Verify the N+1 writers preserve the release N contract when a revision moves between the last check and publication;
- the driver's ledger writes into the accepted record do not move the revision `holds` compares (policy and ledger revisions are separate), so retirements never force concurrent landings to re-judge;
- program readings handed to the driver carry the law stamp and measured identity they were judged under (`judged.law.at`); a reading whose stamp differs from the record it would write into is dropped or re-measured.

**Acceptance:** fixture tests for each target line and each item above; the act's confirmation names every rule it adopts with its digests; `read_inspections` then shows `accepted`.

**Waits on:** the adoption task, the publication task, and release N's restart (the operator's word).

**Reviewers:** Muse lenses (permissions; stored data), `claude-opus-5-5` xhigh, `gpt-6-astra` xhigh (law-astra).
