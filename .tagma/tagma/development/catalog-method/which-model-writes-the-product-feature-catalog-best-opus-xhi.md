---
id: 01a14b95-3bda-7493-b749-8d3b61612504
title: "Which model writes the product feature catalog best: Opus xhigh is the deepest, Sol xhigh is broader and 5x cheaper, cheap models don't qualify"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Anthropic, OpenAI, and Muse models on the Tagma oracle agent",
      "ref": "claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5, gpt-6.1-sol, gpt-6-luna, muse-wonder-1.0-contributor, muse-spark-1.3; runlith 2026-10-17"
    }
  }
---
A comparison of models on one job: a feature catalog of one Tagma product area, written by the `oracle` agent (personal definition: extends tagma, capabilities graph/files/shell/peers/reflections, no sections on commits and worktrees). The goal is to pick the model for the whole-product catalog. Run date — 2026-10-17, that day's runlith checkout.

**Setup.** One area — "agents and collaboration": thread and agent launches, models and providers, delegation, messages and tasks, interruption, stopping, resuming, fork, reports, operator control in the app and through operations, external CLIs, agent definitions. The assignment is verbatim identical for all; a second attempt explicitly added "in the app and through operations". Each model wrote into its own root; reading other roots was forbidden. Records are untagged notes with code paths as the last line. One run per model.

**Measured.** Record counts, time, input/output, and final context — from each thread's `read_thread`. Price — from open API rates on 2026-10-17 via third-party surveys (Anthropic: Opus $4/$20, Sonnet $2/$10, Haiku $0.10/$0.50 up to 100k and $0.50/$2.50 above; hourly cache write 2x input; OpenAI Sol 6.1 $2/$10, cache $0.10, more expensive above 272k); runs went over subscriptions, no dollar bill was issued.

| Model | Records | Time | Input / output | Context | API price |
|---|---|---|---|---|---|
| Opus 5.5 xhigh | 35 | 21:53 | 47.1M / 95k | 486k | ≈ $15.1 |
| Sonnet 5.5 xhigh | 47 | 27+ min | 99.0M / 162k | 691k | ≈ $14.2 (run still going) |
| Sol 6.1 xhigh | 51 | 10:22 | 10.3M / 30k | 442k | ≈ $2.3–3.5 |
| Sol 6.1 high | 35 | 7:47 | 6.1M / 26k | 267k | ≈ $1.55 |
| Wonder 1.0 Contributor xhigh | 22 | 2:22 | 3.1M / 13k | 151k | no rates |
| Haiku 5.5 xhigh | 22 | 8:47 | 8.84M / 91k | 309k | ≈ $0.85 |
| Spark 1.3 xhigh | 13 | 2:31 | 2.0M / 16k | 119k | no rates |
| Luna 6 xhigh | 8 | ~5 min | 5.7M / 22k | 202k | — |

**Quality (reading all records with spot checks against the code).**
- **Opus xhigh** — the deepest: every record has "How / Behaviour / Limits and refusals / Links", composer keys, `/…` commands and CLI, approval modes, providers. The only one to find product-vs-code discrepancies: the `budget-spent`/`spawn-slots-full` refusals are declared but never fire on the server; the `agent.delegation` description promises a check at `fork_thread` that does not exist; the archive wording disagrees with the code. Checked rare refusal codes exist; the three-minute model-switch window is confirmed by explanation 076a4c60. Weakness — sometimes merges neighbouring features into one record.
- **Sonnet xhigh** — Opus-level depth and structure, broader (47 records), a useful cross-cutting record on rights by position in the tree. One wrong inference: the `fork_thread` branch as if recorded by a child (refuted from the code: the branch line is written without a parent); marked it unverified itself.
- **Sol xhigh** — the broadest (51), one feature per record, in the product's words; 12 checked rare refusal codes exist. Shallower than Opus: less "exactly how", and does not hunt discrepancies.
- **Sol high** — 35 records in the product's words, interface and CLI covered; markedly shallower than xhigh.
- **Wonder xhigh** — precise (8 checked details hold), dense "why" notes, but built around tools (`via spawn_agent`); the interface is nearly skipped.
- **Haiku xhigh** — a tool reference, not features; honestly listed the unchecked. Only twice as cheap as Sol high: twice the steps, three times the output, context past the 100k threshold.
- **Spark xhigh** — fastest of all, but narrowed the area itself (dropped the interface) and merges 5–6 features per record, with internal code names leaking into the text.
- **Luna xhigh** — a broad-brush survey, five tools per record, boundaries and failures unopened.

**Conclusion.** For the feature catalog — Opus xhigh: deepest of all and the only one finding product-vs-code discrepancies. Sonnet xhigh costs the same dollars at comparable quality with one inference error — no advantage. Sol xhigh is 5x cheaper, broader, but shallower: fits if cost matters. Cheap models (Haiku, Spark, Luna) and Wonder don't qualify for the catalog. Ranking: Opus xhigh, Sonnet xhigh, Sol xhigh, Sol high, Wonder xhigh, Haiku, Spark, Luna.

**What the run does not establish.** One run per model — run-to-run variance unmeasured. Luna started its first steps on high, then moved to xhigh. Sonnet was still finishing at measurement time. Prices are third-party-rate estimates, not a bill; how subscriptions count these tokens against their quota is unknown. Whether cheap models qualify for answering questions from a finished catalog was not tested.

Threads: Opus 01a14b5a-42b0-7266-94d4-64482b0b875b, Sonnet 01a14b5a-42b1-7f75-b4be-1e8a5441d91c, Sol xhigh 01a14b5a-42af-71aa-976d-e8dea6eee689, Wonder 01a14b5a-42b1-7f75-b4be-1e89f5f7e909, Sol high 01a14b4c-b8f2-7a20-8b20-ac229999b864, Haiku 01a14b4c-b8f3-7a5b-8131-db21ca2bd913, Spark 01a14b54-677c-7600-891a-c25b921380d1, Luna 01a14b54-677c-7600-891a-c25a11443a56.
