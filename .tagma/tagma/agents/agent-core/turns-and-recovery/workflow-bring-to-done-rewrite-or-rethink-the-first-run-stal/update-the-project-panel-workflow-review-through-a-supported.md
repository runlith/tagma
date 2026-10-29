---
id: 01a17324-52e4-7cb2-ad9f-7afe9cb3fa0b
title: Update the project panel workflow review through a supported door
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a172fa-ccae-7e9b-b423-7f05d70b4350
  - kind: relates
    to: 01a16e94-25d4-71b5-b4de-77ee40c6c78e
---
The project `.tagma/workflows/review.json` declares `tagma` participants and assigns them `tagma brief review` and `tagma proposals`. The `tagma` definition is absent; that is an old panel process, and a mere agent-name fix is not enough for it. The workflows contract and the CLI offer only list, start/run, and runs: there is no definition-writing operation, and direct `.tagma` edits are forbidden. A supported way is needed to update the definition together with the current finding preparation, merging, and review. The file was not changed, the workflow was not run; the work's lead takes its further design.
