---
id: 01a0e532-c9fd-7bd4-a50c-bd345b1c2c01
title: "workspace M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-c9df-7dd6-b6d0-459b5b1efac5
---
§7.2.2 milestone `M2` of the `workspace` card ([[f7e0b9dd]]), with its vocabulary amendment [[8950b1dd]]. Transitional binding: `operations/worktrees.ts` resolves graph's `CurrentProject` to `projectId` and passes it to workspace-owned checkout/repository executors; invocation M2 or K0's manifest binding removes that upper adapter once admission supplies the lower caller context directly. Card deviation: `workspace/operations/acts.ts` is not created. `CheckoutWrites` owns each domain act; the present wrappers add only upper-owned rule checks, terminal actor selection and refusal mapping, so extracting them would add forwarding glue or a forbidden upward dependency. K0's `operation()`/`body()` manifest binding takes those declarations while their orchestration remains upper. `graph/projects/WorkingOwners.ts` retains a thin transitional `workspaceLayer(world)` wrapper for existing callers: it constructs today's `HostEnvironment` and passes that backend to pure `workspace/workspace.ts` construction/manifest; executions M1 removes this wrapper when it supplies the backend. In the failure rename, `RootUseRefused.uses[]` remains the single holder identity, rendered in the refusal message; the amendment's “holder named in reason” asks for that evidence, not a redundant `reason` field. `graph/projects/holders.ts` is temporarily graph-owned, not workspace-owned: graph moves `heldTasks` to its task contract, thread-record takes `agentNames`, and change-record takes `namedHolders`/`holderOf` into its `CheckoutHolders` contribution. Those owners dissolve the mixed remainder; workspace consumes only the hook. `http/poolFixture.ts` is composition's testing territory while still at its old path; composition moves the mixed fixture into its test world once that wave gives it a concrete target name.