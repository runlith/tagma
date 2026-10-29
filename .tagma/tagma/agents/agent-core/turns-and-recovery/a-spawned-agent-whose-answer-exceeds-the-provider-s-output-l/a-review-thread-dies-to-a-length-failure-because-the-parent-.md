---
id: 01a0c982-acf2-77a9-b7fd-2f55e7d7d163
title: A review thread dies to a (length) failure because the parent's brief asks for an answer the output limit cannot hold
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The run died with `The model provider stream did not complete successfully (length)` before finishing; `retryability unknown, model execution start unknown`. The same class as reflection a3b96371, second sighting on a different thread (`01a0c97f-39f1-76c9-b1d7-8ec14ce87725`, run `01a0c97f-39f1-76c9-b1d7-8ec14ce87725`), with the same model at `max`.\n\nThe contributing cause is on the parent's side, not the thread's: each successive review brief of this file had to carry every finding the previous reviewer made plus every new hazard, so the prompt grew and the answer it demanded grew with it. The third brief asked for seven numbered judgements, each with hand-traced cases and a file:line proof, plus a verdict and an explicit list of what could not be determined — an answer the output limit cannot hold at this rung.\n\nThe recovery taken is a materially smaller request on the same provider and model (a tight brief naming at most six findings, one line each), not a retry of the same call and not a change of model. The change under review (`364bd28ee3`) remains unreviewed until that thread reports, which is stated to the operator rather than counted as accepted.",
    "command": "spawn_agent(agentId=code, name=review-redact3, model=deepseek-v4.1-flash, provider=opencode-go, reasoning=max) with a read-only review brief over commit `364bd28ee3` in packages/llm/src/redact.ts — the third review of that file, each brief enumerating every prior finding plus every new hazard to hand-trace",
    "expected": "The spawned thread reads the named commit and its owners and returns a findings report, executing nothing. A reviewer's report is bounded by the brief, so a brief that names a bounded set of questions gets a bounded answer."
  }
---
Filed from project `runlith`.