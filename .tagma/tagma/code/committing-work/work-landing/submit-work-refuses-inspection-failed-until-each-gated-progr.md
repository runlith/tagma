---
id: 01a194d5-69dd-717b-8c38-b9c164a26f5c
title: submit_work refuses inspection-failed until each gated program inspection is prepared by hand per HEAD
ord: 177
tags: ["reflection"]
fields:
  {
    "actual": "Refused inspection-failed on 13 gated rules with \"vendor-ids has no revision index for this reader; run check_rules with inspection vendor-ids over change\", then after that call again with \"no ask-calls state within 5000 changed files of <HEAD>; run check_rules with inspection ask-calls\", each retry costing a refusal and a manual check_rules; a third landing went through only once HEAD had moved and ask-calls was prepared against the new HEAD.",
    "command": "submit_work(paths: [symbols.ts, dependencyMembers.itest.ts, checks/builtins.ts], subject: \"fix(code-facts): ...\")",
    "expected": "Land the three paths, preparing whatever revision index the checks/law program inspections (vendor-ids, ask-calls) need for the candidate itself."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T23:25:28.662Z, from 3a395b0b3.

Seen from project tagma on a server up since 2026-10-31T23:25:28Z (3a395b0b3), while landing ed8653efd8. The refusal text names the exact preparing call each time, so it is recoverable, but a session must run one check_rules per program inspection (vendor-ids, ask-calls) with the same paths, and the prepared state is keyed by HEAD, so a peer commit between the prepare and the submit makes it stale again (first ask-calls prepare answered against a6c28e3b27b, the landing then ran against 3b83f29e4f1). Submit_work builds the same candidate tree itself and could prepare the index in that run instead of failing the gate.