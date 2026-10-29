---
id: 01a14bae-6720-7d62-897a-9292bfecd8d9
title: Workflow launches a pre-described team of agents under its own thread and collects their reports
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92780a5d8623
  - kind: supersedes
    to: 01a14b6d-b268-76a0-a04d-096682d7bf11
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/cli/workflows.ts
  - kind: file
    ref: packages/agent/src/workflow/definition.ts
  - kind: file
    ref: packages/agent/src/workflow/engine.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/workflows.ts
    symbol: WORKFLOW_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/workflows/sources.ts
    symbol: readWorkflowLibrary
---
**Value.** Repeating work of several agents is described once and launched by name; the server itself runs the steps, births the members, and collects their reports.

**How.** Workflow JSON files in the project or in the server data directory; the `list_workflows`, `start_workflow`, and `list_workflow_runs` operations; the `tagma workflow` CLI.

**Behaviour.** The run goes under its own thread, the members are its children. The engine collects their final and fallback reports: they are saved but do not open the managing model's turn. A member's end does not replace the report on a still open request. A step is one agent, a pack of parallel agents completing with "all" or "at least N", a transform, or a nested workflow; transitions can be conditional, a step's output is the members' reports. An execution failure saves failed on the step and the run and lands in the error list; an interruption leaves a lease to continue. A project file shadows a personal one of the same name.

**Limits.** A pack missing the step deadline counts the ones that reported. A transform is only one the host declared. Members obey delegation and offered types, and a member cannot be detached.
