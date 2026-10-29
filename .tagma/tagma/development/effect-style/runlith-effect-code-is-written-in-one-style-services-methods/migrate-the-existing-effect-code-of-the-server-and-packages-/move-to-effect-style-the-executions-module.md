---
id: 01a13c96-169f-74aa-b870-a2c1bf2f78b7
title: "Move to Effect style: the executions module"
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c96-629f-79f9-a4bc-2d24777e7959",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/executions
---
The production code and tests of `apps/tagma/server/src/executions` follow the `effect4` skill. Proof is zero effect-style findings for the module, module typecheck and tests green, spans preserved.

Done in d0e4c8a819: effect-style for the module 0 (was 357), server typecheck clean, module tests 342/342, composition consumers green. New spans: `HostActivation.adoption`, `HostBoot.stateClaim`.

Not proven:
- the `HostFloor` floor-field stayed a class under another name — [[93e5aa01]];
- stests were not run: `laneCustody`, `managedWorld`, `recoveryRoad`, `terminalWidget`, `protocol*`;
- `environmentRoad`, `activationCustody`, `failureRoads`, `wholePath`, `laneCustody`, `recoveryRoad`, `managedWorld`, `terminalWidget`, `protocolRig` assemble the floor through make factories but still run through `ManagedRuntime`/`runPromise`;
- the module's 24 ea465bed debt points are the same work's next commit.
