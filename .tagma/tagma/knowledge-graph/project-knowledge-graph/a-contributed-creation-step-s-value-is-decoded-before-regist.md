---
id: 01a19471-08a4-7bbf-81ef-e50552368ef6
title: A contributed creation step's value is decoded before registration, and its step runs after the registration commits and before the graph first opens
ord: 263
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/service/creation.ts
  - kind: file
    ref: apps/tagma/server/src/graph/operations/registry.ts
---
`add_project` decodes every `contributed` entry with its step's own schema before anything is written. An undecodable value and an id no step of this build takes both refuse the call with `field-invalid`, and nothing is registered. Without that check, an entry meant for a step this server lacks would be dropped silently, and the operator's input with it.

The decoded steps run inside `ProjectLifecycle.create`'s birth hook. By then the registration has committed, so a step can address the project by id. The steps run before `ServedGraphs.birth`, so a step that shapes where the graph comes from acts before the graph's first opening, the way a remote restored at registration must. The hook's failure takes the registration back, so a refused step leaves no project: the operator corrects the field and creates again, instead of meeting a `returned` project that skipped the step. A returned project runs no step, like the other inputs that apply only to a project born here.

Every step refusal leaves with the entry's id in the refusal's `field`, set by the owner (`GateRefusal.about`) rather than by the step. The new-project dialog uses it to put the refusal under the field that sent the value.