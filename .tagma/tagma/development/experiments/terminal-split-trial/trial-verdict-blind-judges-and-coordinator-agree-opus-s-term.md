---
id: 01a0e4dc-762c-78bf-a032-426dbbbaa563
title: "Trial verdict: blind judges and coordinator agree Opus's Terminals.ts split is the only one that separates the contract"
ord: 7
---
Both blind judges and the coordinator put Opus first by a wide margin; they agree that only Opus separated the contract from the implementation, and they disagree only on the order of the rest.

**Setup.** Five anonymised diffs against `25c3297851` (A Step 5, B Opus, C Sol — working tree including the uncommitted importers, D Astra, E DeepSeek; Muse had nothing to judge). Judges: `judge-opus` (claude-opus-5-5 xhigh) and `judge-sol` (gpt-6-sol xhigh), each with the implementers' brief and six criteria, barred from the graph notes of this trial. Judgements: `judgement.md` in each judge's scratch.

**Rankings.**

| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Opus judge | Opus | Sol | DeepSeek | Astra | Step 5 |
| Sol judge | Opus | DeepSeek | Sol | Step 5 | Astra |
| Coordinator (not blind, architecture score) | Opus 9 | DeepSeek 7 | Astra 6 | Step 5 5 | Sol 5 |

**Architecture score (1–10), where the ranking is decided:** Opus 9 / 8 / 9 (Opus judge / Sol judge / coordinator); DeepSeek 4 / 5 / 7; Sol 5 / 4 / 5; Astra 2 / 2 / 6; Step 5 3 / 3 / 5.

**What the judges established beyond the coordinator's reading.**
- The Opus judge applied each diff to a copy and compared all 73 `Effect.fn` bodies and all string literals with the original: every candidate preserves behaviour except Step 5, whose rename also rewrote a log message (`reads.ts:156`).
- Opus's cut is the only one either judge would merge. Remaining nits: `service.ts:66` imports the type `TerminalDischarge` from the implementation (Sol judge would block until it moves into the contract); `TerminalsFaces` is one letter from the layer's `TerminalFaces`; `retaken` belongs outside `refs.ts`.
- Astra's contract file *is* the implementation (value-imports every part, holds the class and factory) — both judges score it 2 on architecture; the coordinator had weighted its execution discipline.
- DeepSeek and Step 5 type the tag by the implementation class, exposing internal state to every dependent.
- Sol's cut, read as a diff, is behaviour-identical but glues parts with `Object.assign` and declaration merging, so the compiler no longer proves the instance has its members; its delivery failure (uncommitted importers) is visible only in the branch.

**Conclusion.** For a cut whose point is a module boundary, Opus is the only model that produced the intended contract; the others move code correctly but leave the boundary where it was or make it worse. Astra is the weakest at the boundary despite the best execution discipline, and costs about three times Opus.
