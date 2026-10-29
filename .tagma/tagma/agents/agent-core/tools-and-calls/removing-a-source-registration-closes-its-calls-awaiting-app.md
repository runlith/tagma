---
id: 01a15207-69d4-7fac-a0cc-f08648e8b029
title: Removing a source registration closes its calls' awaiting approvals; a repeated id does not bring them back
ord: 8
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a151e9-674e-7bdb-8965-3d9c3749f744
sources:
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.ts
  - kind: file
    ref: packages/agent/src/catalog/toolSources.ts
  - kind: file
    ref: packages/agent/src/registry/Registry.ts
  - kind: file
    ref: packages/agent/src/thread/run/hostedAsks.ts
  - kind: file
    ref: packages/agent/src/thread/run/ParkedQuestions.ts
---
Removing a source's registration closes its calls' awaiting approvals; a repeated id does not bring them back.

Approval belongs to a concrete source registration, not to the contributor's name: otherwise a plugin restart could resolve a new tool on a question about the old one. Removing that registration closes the wait on the native and hosted roads with the typed `contributor-absent` outcome, without executing the call; the run continues with that result. The removal cause is stored in the question record itself: the hosted road records the tool's final result separately, and a process loss between those records must not turn `contributor-absent` into an operator refusal on retry. A call already started ends with its own outcome.
