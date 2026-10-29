---
id: 01a14564-656e-7e40-9f43-ef39c681ad09
title: "project.birth from a foreign checkout took the foreign tree's floor and waited for its refresh under the machine base's writer: the whole machine write stood still for 15 minutes"
ord: 60
tags: ["task"]
fields:
  {
    "holder": "claude-code:5e6fa99d-7c0f-4991-9323-91a1704dc193",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14564-656e-7e40-9f43-ef3419f5c986
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/birth.ts
  - kind: file
    ref: apps/tagma/server/src/installation/registry/export.ts
---
The `project.birth` transaction held the `tagma.sqlite` writer for 900 s while executing nothing in SQLite itself (`5 statement(s), engine 0ms, outside sqlite 900.0s`), and the whole machine write stood still for 15 minutes.

The mechanism, verified against the code and reproduced by a test:
- `add_project`, called from a served project's checkout, runs in that place's context: `placeContext` (`graph/serving/routing.ts`) removes the mirror's `ProjectLifecycle` and `ProjectPolicy` from it but keeps the mirror's `TreeGuard`.
- The machine graph's `ProjectLifecycle.create` takes the machine base writer, and the `act.unit` inside reads the `TreeGuard` from the call context, getting a foreign tree's floor instead of `machineRetirementGate`.
- This floor's `prepare` settles the foreign tree (`FreshnessGate.settled`) under the machine base's open unit. That violates the [[1e4a8f0d|settle-before-opening-a-unit law]].
- That tree's refresh first copies the registry (`MirrorBuilder.syncRegistry`) and reads `project` through the machine base writer — which birth is holding. The wait goes through `Deferred`, so `held` never sees the loop.

What was done:
- The machine graph binds its registry services to its own context ([[0a8e61b0|binding note]]). Project registration, move, removal, and policy run on the machine graph's floor, wherever they are called from.
- `FreshnessGate.settled` refuses anyone waiting for a tree refresh while holding the machine base writer or that tree's mirror writer ([[ce9b0fcf|refusal note]]).
- The registry copy in the mirror is read through the machine base readers, in one snapshot ([[0e2874e9|registry-read note]]); the registry dump also reads through readers.

Verified, with the tests red without their own fix:
- `routing.itest.ts`: a project registered from a call in a served checkout is born in the machine graph, and its `project_add` is signed by the caller. Without the binding the test fails with `tree-refresh … was waited on while holding writer:…/tagma.sqlite`.
- `machineWriter.itest.ts`: settling under the machine base writer refuses before waiting, and the writer stays free; the tree refreshes through the shifted registry while another transaction holds the machine base writer. Without reading through readers the second test hangs until timeout.
- Server typecheck. Full server integration run: 3368 passed, 19 failed — all outside the fix: the thread feed holding another session's uncommitted edits, speech, CLI exit codes, `read_inspections`, `set_module`, event-loop parsers, and the load budget from commit `dfb580c9c6`; not one `WaitUnderHold`.
- System tests `servingDrill`, `concurrencyDrill`, `projectsDoor`.

Next — [[58d1f4aa|task on the invisible writer hold]].
