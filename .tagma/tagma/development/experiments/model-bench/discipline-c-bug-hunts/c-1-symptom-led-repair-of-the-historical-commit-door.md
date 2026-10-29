---
id: 01a0c4f7-9227-780c-bddf-d455198f0c3f
title: "C-1: symptom-led repair of the historical commit door"
ord: 1
---
C-1 is a symptom-led commit-door bug hunt on `c889d570a85ec45292f48f598270361d330fb046`.

- **Input.** A session edits a file several times, rewrites another, deletes a third and renames a fourth; some paths fail to enter the commit without a useful explanation. The brief supplies symptoms, never the documented root cause.
- **Expected result.** Find the wrong producer, fix it, and provide a repro that fails on the unchanged snapshot and passes with the fix. Existing unrelated baseline failures are recorded separately.
- **Reference.** The historical repair is the series `14d0fdf0e..b58de2495`. It is withheld from workers and available only to the evaluator; [[79ff4b56]] supplies the discipline context.
- **Isolation.** The worker cannot access the newer C-2 snapshot or source history. Git is available for disposable test repositories, not for reading our reference implementation.