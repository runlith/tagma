---
id: 01a132f4-5df4-7701-ba0e-1497c9c42c8c
title: grep returns no bounded page when held stdout overflows
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "Instead of a page came “[grep] error: BadResource: executionSpawner.stdout: execution 6f741129-370d-4f47-9868-0f713eb95396:163 stdout: output exceeded the retained record; read the retained bytes under this execution reference”; matches and cursor lost.",
    "command": "grep({pattern:\"claim_task|release_task|ready_tasks|accept_proposal|reject_proposal|uphold_proposal|revise_proposal|read_proposals|enforce_rule|set_rule_enabled|check_rules\",include:\"*.{ts,svelte,md,json,jsonc,sql,yaml,yml}\",limit:100})",
    "expected": "Reading returns at most 100 matches and a next-page cursor, or plainly states the result size."
  }
---
Filed from project `runlith`.
