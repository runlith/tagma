---
id: 01a0c4f7-9225-7901-87b5-4a9b79ff4b56
title: "Discipline C: bug hunts"
ord: 2
---
The bug discipline separates a historical root-cause hunt from two fixes on current code.

- **C-1.** [[198f0c3f]] gives symptoms and requires an owner-level repair with a failing-before/passing-after repro.
- **C-2.** [[bc709665]] assigns storage-home isolation and incremental history persistence on one pinned snapshot. Its acceptance criteria are recorded before execution.
- **Leakage constraint.** The newer C-2 code can reveal C-1's answer. [[c12b7eb7]] therefore needs an allocation decision before launch; giving both snapshots to one model context is not a blind trial.
- **Evaluation.** Exact mechanism, repair at the producer, proof strength and unintended behavior changes matter. [[e7d2232a]] governs blind judgment; [[e9706241]] governs admission. Infrastructure failures are recorded separately from candidate failures.