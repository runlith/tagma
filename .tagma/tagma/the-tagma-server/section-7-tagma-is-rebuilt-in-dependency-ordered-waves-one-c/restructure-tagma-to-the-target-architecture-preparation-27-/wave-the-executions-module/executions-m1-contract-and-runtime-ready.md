---
id: 01a0e532-cb81-7175-a49a-cfaddab0cf5c
title: "executions M1: contract and runtime ready"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e5c4-94b9-7fed-bbb0-6060db0ffafa",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c833-7e69-8475-95bc0f489891
  - kind: waits-on
    to: 01a0e532-c85d-77a2-b8b1-9e87acb22feb
  - kind: waits-on
    to: 01a0e532-c891-73a5-8ec2-0df102919a95
  - kind: waits-on
    to: 01a0e532-c949-7ee7-90f4-b9199b5cb879
  - kind: waits-on
    to: 01a0e532-c9df-7dd6-b6d0-459b5b1efac5
  - kind: waits-on
    to: 01a0e532-cabb-7020-924a-237a4954809f
  - kind: waits-on
    to: 01a0e532-cb0e-7939-89f0-df086e97083b
  - kind: waits-on
    to: 01a0e532-cf5c-79fb-9e24-8c515b6f255b
---
§7.2.2 milestone `M1` of the `executions` card ([[f7e0b9dd]]), with its vocabulary amendment [[08edfbc5]]. Take over supplying workspace's `EnvironmentBackend` from the old `HostEnvironment` construction in `graph/projects/WorkingOwners.ts#workspaceLayer(world)` and remove that transitional wrapper and its old call sites in the same change. Add `workspace/workspace.ts`'s installation lifetime to its manifest when the backend is supplied; it remains absent during this transitional binding, with no duplicate Backend port.

**As built** (29e6b3cfba, 8c3832bfcf, 093e4eef21, f9b453e722, 3ced66aabc, 28b6fc162a):
- Workspace's host `EnvironmentBackend` comes from executions (`executions/host/environmentBackend.ts#hostEnvironmentLayer`, filling workspace's `EnvironmentBackends`); `graph/projects/WorkingOwners.ts` is gone; `workspace/workspace.ts#workspaceLayer` is a Layer value reading the backend and the new workspace tag `GraphDirectory` from context, and the workspace manifest carries it as `lifetimes.installation`.
- The wire contract is `executions/contract/wire/` (floor 7 of f49f228f, below `protocol/`); every executions service tag is declared in `executions/contract/service/` with a `tagma/executions/<Tag>` id, inline shape and a private mechanism class; the trial `Terminals` tag is the amendment's ten tags filled by one `HostTerminals`; `TerminalOwners`/`ExecutionFaces` are gone.
- Ports: `HostPace` and `SuccessionSteps` filled by executions; `NoticeTakeBack` declared by executions (bound meanwhile to `commandNoticeTakeBack`); `TerminalAdopters` declared, filled by the harness adoption; `ProgramRoad` is executions'. The custody literal `'foreign'` is `'other'` in the machine state, CLI and app.
- Migration reports are manifest contributions (`Manifest.reports`): executions, providers and thread-record each contribute theirs, `composition/reports.ts` assembles `MACHINE_REPORTS`; `db/landedReports.ts` is gone.
- The CLI reads command bytes only through `op` (`read_command_bytes`).

**Divergences from 08edfbc5 / the card:**
- Seven tags the amendment does not name, each holding exactly what cross-module consumers read: `HostState` (boot, custodian, detail, state, birthNotice, report, connection), `ViewLeases`, `ViewLanes`, `TerminalGrids`, `TerminalHolds` (fencesOf, heldBy, holdingUses), `ExecutionEndings` (decided), `ExecutionNotices` (ended, displaced, takingBack, hostReplaced). They replace the dissolved `TerminalOwners` bag.
- `ManagedCommands` is served as a record over the same `HostTerminals` instance: its member names collide with `Terminals`, `ExecutionRecords` and `Custody`.
- `TerminalAdopters` has the single member `of(projectId, executions)`, the read executions actually consumes; the adopt act stays harness's behind `tagma/harness/SessionAdoption`.
- After a host replacement the agent pace is re-handed through `ExecutionNotices.hostReplaced`, filled by the runtime with `AgentPace.rehand` (amendment: composition re-hands after replacement); that binding and `hostEnvironmentLayer` sit in `http/runtime.ts`, not in `composition/start.ts`.
- The contract service is split by subject (terminals, writing, custody, records, discharge, commands, host and the rest) rather than one `terminals.ts` (names F3).
- The executions, providers and thread-record manifests appear at M1 carrying tables and reports only, because the report contribution needed them; their layers and lifetimes land at M2.
- `tagma command bytes --stream pty` now refuses `body-shape` at the operation's `stdout|stderr` params instead of reaching the record reader.
- Debt: `installation -> executions @ installation/contract/service/steps.ts` (type import of `TerminalUnavailable`), owned by installation M2 (45779ef0).

**Left to M2:** the 79-file map, `executions/cli.ts`, the five operator-only K2 ids, the manifest's layers and lifetimes. Integration and system tests touched by this milestone are unrun (listed on [[4a9013bf]]).