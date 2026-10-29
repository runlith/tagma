---
id: 01a15963-9d3a-7088-9b4c-7b504b9e8ea0
title: "Implement the child wake-up cost: report tail, child-agent-update signals, cold-wake refusal, prompt text"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15956-a65b-7906-b9bf-10495b7e1ad6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15930-26eb-7874-9b68-a972b1d6e8da
---
Assemble the whole spec in one delivery: the child state field in the report envelope and the `context`/`warm-until` attributes; the child-transition driver in the threads module; the `cold-wake` refusal on `send_message`/`send_task`/`compact_agent` with the `wake` flag and the `threads.coldWakeRefusal`/`threads.coldWakeTokens` settings; the new `handoffGuidance` and operation descriptions; then delete rule 5bc2a638 in global. Proof: minimal public contract tests of the door, the report and the driver, `bun run typecheck`, one Sol reviewer, commit.
