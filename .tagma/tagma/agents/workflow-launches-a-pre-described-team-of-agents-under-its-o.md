---
id: 01a14b6d-b268-76a0-a04d-096682d7bf11
title: Workflow launches a pre-described team of agents under its own thread and collects their reports
ord: 29
---
Repeating work of several agents is described once as a workflow and launched by name: the server itself runs the steps, births the members, and collects their reports under a separate thread.

**How.** JSON definitions in the project's `.tagma/workflows/` and the data directory's `workflows/`. `list_workflows` — what can be launched and which files never became a workflow; `start_workflow` — the name, `input` (the fields the workflow declares), and `scopeName` (the block in whose subtree the run's thread opens); `list_workflow_runs` — runs, freshest first, with the steps passed. From the terminal — `tagma workflow list`, `tagma workflow runs`, `tagma workflow run <name> --input '<JSON>' [--scope]`. A project file shadows a personal file of the same name. Agents get the operations with the `peers` capability.

**Steps.** `agent` — one member of the set type with a task and bound inputs (from the run input, from a step output, an element and a list index); `pack` — N members (up to 64, the count can come from the input or a step output), completing with `all` or `at-least`; `transform` — a transform through a host-declared seam (`standing-proposals` now); `call` — a nested workflow. Transitions between steps take an optional condition. A step with members outputs their reports.

**Limits and refusals.** Members are the run thread's children: missing the step deadline leaves the step `exhausted` with the count that reported. An unknown workflow — `workflow-unknown`, bad inputs — `workflow-arguments`; delegation off — `delegation-off`; an unknown or unoffered member type — `unknown-type` / `type-withheld`. A workflow member cannot be detached (`workflow-member`).

Code: packages/agent/src/workflow/definition.ts, packages/agent/src/workflow/engine.ts, apps/tagma/server/src/native-harness/contract/wire/operations/workflows.ts#WORKFLOW_OPERATIONS, apps/tagma/server/src/native-harness/workflows/sources.ts#readWorkflowLibrary, apps/tagma/server/src/native-harness/cli/workflows.ts
