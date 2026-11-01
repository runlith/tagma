---
id: 01a195a5-1311-7d3c-bfa5-65342ea13896
title: Release tool order and thread claims when preparation ends without execution
ord: 209
tags: ["task"]
fields:
  {
    "holder": "tagma:01a195a4-ba41-718d-a35e-a989189b1ad0",
    "status": "done"
  }
---
A concurrent hosted sealed-message scan can place a predecessor after its preparation refusal has released it; the closure watcher sees that call still hosted while its committed response is being acknowledged and leaves the new claim standing. Make ordering release terminal within its door and cover interrupted preparation too. The deterministic ThreadHosting regression reproduces the background wait and blocked graph mutation on 4113b5f547 and its parent 4a64b540af5298afba1e28f37ccd8a3addf1e2b8, so the defect predates that commit and the later e3d99eddc5/ac74a52989 changes. The operator can stop the waiting background invocations through direct control_call operations outside the agent's tool queue, then stop the run to close its old door.