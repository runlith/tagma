---
id: 01a12750-dc1b-7c1e-b241-07bc12a4902b
title: Finished executions' root accounting is deleted after release, history lives until the thread is deleted
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/store/history.ts
---
The command-to-thread link is textual, so ExecutionHistory deletes its finished history explicitly. After discharge the execution record persists, but the freed root use and its retentions are deleted; a repeated completion reads the discharged obligation. Projection never returns a removed root_use_id. Only released uses of command/terminal consumers are deleted, with no references from a running execution or an unfinished intent. What accumulated is worked through by forgetGone on Maintenance.opened and once a day in 25 ms portions with a pause no shorter than the portion; incoming-FK indexes allow deleting a use without fully reading history.
