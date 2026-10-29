---
id: 01a0c4f7-920e-7d37-8c2c-8cfbc2d339bb
title: Model bench
ord: 4
---
The model bench compares seven models on one architecture cut and three bugs; contestant launch is blocked on the isolated execution design `57a174d4`.

- **Solvers.** GPT-6 Astra, GPT-5.6 Sol, Opus 5, Fable 5.1, Grok 4.6 and Muse Spark 1.3 contributor use xhigh; Grok 4.5 uses high. Both workload groups are intended to run concurrently once admitted.
- **Workloads.** [[4ac015f4]] asks for a behavior-preserving architecture cut; [[79ff4b56]] contains a historical bug hunt and the two current-code fixes; [[e25a3a61]] adds three silent multi-layer bug hunts from the harness-terminal session, each pinned to its start commit. Source revisions are fixed before preparation, never read from a moving HEAD during runs.
- **Isolation.** [[e9706241]] is the admission contract, not a claim that host folders are sandboxed. [[c12b7eb7]] keeps the unresolved allocation/count change visible: the original C-agent arrangement exposes the answer through its second tree.
- **Judges.** [[e7d2232a]] names six independent judges, Grok 4.5 excluded. The shipped reference is a comparison entry, not a required winner.
- **Outputs.** Retain manifests, checks, candidate files and judgments before any cleanup. Nothing enters main through the benchmark. Invalid harness runs carry no model-quality verdict.
- **Method.** `72f242ad` supplies the change-task approach; `ef2ea2ac` records limited earlier blind-judging observations, not proof that family bias is absent.
Carried over from the pre-dictionary-migration graph (archive `.tagma/.archive/2026-09-20`, root `01a06e9a-9d2f-7bc6-b094-169e82314c08`).
