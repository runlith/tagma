---
id: 01a0daf7-7e6e-70af-a172-477414d73068
title: A trace reading's coverage names the payloads a run's bundle withheld by family, count and cause, and names a run unavailable only when its bundle is gone
ord: 17
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0daf7-4a8b-74b5-8953-75b9cd95a677
sources:
  - kind: file
    ref: apps/tagma/server/src/projection/thread.ts
  - kind: file
    ref: packages/trace-bundle/src/bundle.ts
---
**1. Outcome.** A `select: trace` reading names what it is actually missing, per run: which payload families, how many, and whether the fact itself is missing. A run whose facts are all present is never named in `coverage.unavailable`. That list keeps only runs whose retained trace is gone.

**2. Problem and evidence.**
- Thread `01a0d591-…` (project 7) printed `unavailable: 29 — retained evidence that is gone` for every run, the current one included, while it answered that run's tool facts.
- The bundle of run `01a0daa4-…` holds 126 drop records and 236 steps. Every drop is a `model-response` payload of 51,481 to 166,641 bytes (median 63,752), declined at the 51,200-byte envelope by design ([[d3e5b6dc]]). The event naming it was written without the reference.

**3. What holds now.**
- `ThreadEvidence.traceBoundOf` pins `unavailable: trace.drops.length > 0`, and `traceQuery` pushes a run into `unavailable` when the pin says so, or when an unpinned bundle has any drop.
- `TraceDrop` is `{ event, reason }`, and the reason is prose. Two producers write payload drops, both in `TraceBundles.payload`:
  - a declined payload (`TooLarge`, template `the <kind> payload <n> of <b> bytes exceeds the <c>-byte ceiling…`) — the event is still written, its reference stripped;
  - a failed write — the event naming it is never written ([[ad46e51d]]).
- Nothing writes an event drop.

**4. Target model.**
- A drop record states what it lost as data: `payload: { kind, cause }`, where `cause` is `declined` (over the envelope; the fact stands without its body) or `unwritten` (the write failed; the fact naming it is missing too). `TraceBundles` writes both.
- Replay reads a record written before this field by its producer's template: the declined template gives its kind, and any other payload drop is `unwritten` with no kind named.
- `traceQuery` adds a coverage list, `withheld`, with one entry per run, family and cause, carrying a count.
- `unavailable` names only runs whose bundle is gone.
- `complete` is false when a run is unavailable or a fact is `unwritten`. Declined bodies leave it true, because every fact was read.
- `evidenceText` renders the list. The protocol answer and retained aggregates carry it.

**5. Owners and boundaries.**
- `packages/trace-bundle` owns the drop record and its legacy reading.
- `apps/tagma/server/src/harness/ThreadEvidence.ts` owns the coverage.
- `projection/thread.ts` renders it.
- `protocol/evidence.ts` and `EvidenceReads.ts` carry it.
- The kernel's `ThreadQueryCoverage` is not touched: the server extends it for the trace source it owns.

**6. Rejected.**
- *Counting drops against `unavailable`.* It calls present facts gone — the defect itself.
- *Parsing the reason prose at read time for every record.* The template is read only for records written before the field existed.
- *Reversing the envelope.* That is the operator's decision; see 18.

**7. Acceptance.**
- (a) A run whose bundle holds declined response drops is absent from `unavailable`. Its coverage names `model-response × n` declined, and `complete` stays true.
- (b) An unwritten payload names its kind and makes `complete` false.
- (c) A legacy drop record reads with its kind.
- (d) A run whose bundle is gone stays in `unavailable`.
- (e) Typecheck and the unit and integration layers of `trace-bundle` and `apps/tagma/server` pass.

**8. Claims and tasks.**
- New claims: over the drop record, over the coverage in `ThreadEvidence`, and over the rendering.
- [[d99ede3e]] is revised: it says what could not be read is named as gone.
- [[39bdd03b]] gains the structured cause.
- The `read_thread` description names `withheld`.

**9. Order.** Drop record and replay → coverage → rendering and protocol → tests → claims.

**10. Contract.**
- `TraceDrop.payload` is optional and additive.
- `coverage.withheld` is optional and additive in the answer schema and the retained result schema. Old readers ignore it.

**11. Stored data.**
- Bundles written before carry no `payload` field; replay reads them by the template, and nothing is rewritten.
- A retained reading pinned before this change keeps its pinned `unavailable` flag, so its continuation pages answer as it began.
- Rollback leaves records with an extra field that the old reader ignores.

**12. Who may do what.** out: no authority changes.

**13. Long-lived things.** out.

**14. Bounded resources.** The list has at most runs × families × causes entries per reading.

**15. Rollout.** A reading opened after restart answers the new coverage.

**16. Failures.** out: a read failure keeps its current handling.

**17. Observability.** The incident thread's reading names `model-response × 126 declined` for its run and no run as gone.

**18. The envelope.**
- The measured response payload is about 20 KB of the native provider message, 26 KB of stream events that repeat the message, 0.5 KB of content and usage.
- The envelope therefore declines exactly the long answers: 126 of 236 responses in the incident run.
- The answer's content survives in the thread log. What is lost is wire-level evidence (native blocks, signatures, per-event timing and usage) for more than half the steps.
- A recommendation goes to the operator; this decision does not change the envelope.


**Divergence found in review.** A plain paged reading lists a run's `withheld` entries only on the page that opens the run. `complete` is judged on every page that reads it, so an `unwritten` payload keeps a later page from answering `complete: true`. The losses of a paged reading are therefore the union over its pages, and the `read_thread` grammar says so ([[224e9654]]). A run whose bundle vanished between pages is named `unavailable` on the page that meets the absence.
