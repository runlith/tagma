---
id: 01a11ca5-7ddf-7f42-a891-bd5e610af73e
title: "Transport contract and native adapter: Transports, TransportRuns, RunReports; launch from after-commit, holds and one beater, launch-failure rule"
ord: 9
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60ad2121a95f
  - kind: waits-on
    to: 01a11ca5-7ddf-7f42-a891-bd5c10ac73a6
  - kind: waits-on
    to: 01a11ca5-7ddf-7f42-a891-bd5d91202942
---
What: `packages/agent/src/thread/transport` per [[2121a95f]] — the `Transports` registry by binding, the contract subjects, `RunReports` as write plans via `transitionIn`, the native adapter in `transport/native`, registration in composition. The scheduler calls `launch` from the open's after-commit; one core beater beats runs by `holds`; two `launch` failures in a row stop the wake. ACP stays on the hosted road for now — later tasks move it.

Proof: contract conformance on a fake adapter and the race tests from the [[2121a95f]] criteria that concern native; the existing run conformance suites with no changed assertions.
