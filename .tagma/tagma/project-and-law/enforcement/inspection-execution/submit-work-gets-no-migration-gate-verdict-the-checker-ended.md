---
id: 01a12cbf-121a-7e08-91dc-82b335da1460
title: "submit_work gets no migration-gate verdict: the checker ended with terminal-stale-authority and no execution ref"
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "refused[inspection-failed]: d81b1676, checker runlith-law ended and its console could not be read: terminal-stale-authority. No landing happened; no checker execution ref was issued.",
    "command": "submit_work({subject:\"Preserve streaming output under bounded retention\",paths:[\"packages/execution-host\",\"packages/executions\"]})",
    "expected": "The landing receives the migration gate's verdict and lands its own streaming lines; when the checker is unreachable it names the execution address for recovery."
  }
---
The operator's working server does not yet contain e3d3ce1d92: the old Observe/Await binding to a temporary rootUse makes reading the checker's console stale at cleanup, and the old diagnostics do not print execution/incarnation. After the door's recovery, a separate d81b1676 check yielded no violation; the subsequent 39035be8b2 landing passed with the same commit steps and gates. This refusal established no new cause.
