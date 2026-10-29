---
id: 01a172fa-ccae-7e9b-b423-7f05d70b4350
title: Workflow collects reports without the controlling thread's turn and keeps the run failure
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a172fa-4014-751a-9d72-1ec231a25a00",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16e94-25d4-71b5-b4de-77ee40c6c78e
---
Workflow reports, including an external harness's unread assignment, are kept for the engine with no turn of the controlling model. The collector accounts for request closing and late `final` publication, and a `final` read-back restores the confirmed outcome by the keyed witness. A step error keeps failed at the step and the run and is seen via `read_faults`; an interrupt leaves the run resumable by lease. The two-participant → chair pack scenario is proven through `start_workflow` in an isolated door world with a scripted model; unit/conformance and standalone seeds 1–3 are green, the agent package types checked. One independent review found three extra windows, each confirmed by a red test and fixed. The separate BirthConflict was already fixed by commit 7d3ee05acb. The outdated panel review was neither changed nor run: its standalone rework goes to the [[9cb3fa0b|open review-definition task]].
