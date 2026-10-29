---
id: 01a0e532-ca72-7893-99fe-0e2dcf64b2b5
title: "graph M1: contract and runtime ready"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e816-300f-732c-a1c2-61a63ba56cdd",
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
    to: 01a0e532-c9df-7dd6-b6d0-459b5b1efac5
---
§7.2.2 milestone `M1` of the `graph` card ([[f7e0b9dd]]), with its vocabulary amendment [[8950b1dd]]. Graph D1 must supply owner-aware offline store selection: D0's `db migrate` accepts only the configured machine store, because applying its migration reports to a graph mirror selects the wrong owner. Graph mirrors continue to migrate through their own open; `restore-snapshot --store` remains available within the installation directory. The graph's `core/reads.ts` still imports sqlite-process directly. Move its read-only marker through `GraphUnits`: implementing layers yield the graph-branded units once and supply them to internal readers, without leaking `GraphUnits` into published ports. The affected port implementations are Ranking, Selection, SettingDeclarations/Settings, Trash, Journal, Orientation, Reading, Touches, Projects and ProjectPolicy; typecheck currently refuses their `GraphUnits` requirement against ports whose R is `never`.

Card item that does not apply: `contract/wire/call.ts` receives no refusal unions. `CallerRefusal`, `OpenRefusal` and `ReferenceRefusal` stay in `platform/contract/wire/refusal.ts`, and `ServingRefusal` is not created — no code refuses with it. `call.ts` holds `NameReach`, `Lens`, `ProjectRef` and `ProjectCall`; `CurrentProject` is `tagma/graph/CurrentProject` in graph's `contract/service`.