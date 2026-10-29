---
id: 01a14d97-4e5c-7ee0-927a-45b079d15f81
title: "Parity of ACP stop: a stopped turn's end is visible before its successor, a stop on the step boundary waits for it, plus model-move and agent-stop scenarios"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01f6-7d00-af4d-7f2b2b1aecb7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14cf8-6247-7746-9036-752abccb479c
  - kind: implements
    to: 01a14cba-e095-7bcb-bb6f-608245d13bf3
---
Two divergences found in [[bccb479c]]:
- Stop with steer: on native the snapshot shows the stopped turn ended, on `acp` `ending: null`, because the successor opens earlier. Find the owner of the "close the stopped one" — "open the continuation" order and fix it there.
- Stop waiting for a step boundary (`awaitSettled`: model move, interrupt on a step) closes an adapter-run at once without a tail, while native waits for the boundary. Make it wait the same way, or prove the behaviour matches.

Add parity-suite scenarios for a model move between roads and a stop by an interrupt task (`by: agent`). Proof — the suite, commit.

## Outcome (cd5a485f07)

- Steer: no product divergence. The stopped turn ends `aborted` on both roads. The test read the thread status after the successor had opened. Now it reads the end of the very run it stopped.
- A step-stop on an adapter run did not close it at once: it waited for the turn end, because the core cannot see adapter step boundaries. A stop with `awaitSettled` and no step (rewind, delete) closed it at once before. Now it waits for the adapter's end, as native waits for its fiber.
- The model-move scenario found a defect on both roads. A turn waiting for a question answer never reached the step boundary: the answer refused `ThreadRunHeld` because admission held the move. The move hung until the window ended. Now a step-stop of such a turn stops it at once on both roads.
- Suite: model move between roads with a waiting question — no record, `aborted` end on both; a parent's interrupt task mid-text — "Interrupted by user" on both.

Not proven: a mid-text model move on `acp` waits for the turn end (the core cannot see vendor steps), on native for the step boundary; there is no scenario for that.
