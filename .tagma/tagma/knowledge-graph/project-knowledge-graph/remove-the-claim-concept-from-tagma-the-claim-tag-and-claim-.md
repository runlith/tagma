---
id: 01a0f95f-71a5-7ca0-be87-3edc15895a38
title: "Remove the claim concept from Tagma: the #claim tag and claim role, verification, source measurement, claims in the touch road, briefs and prompts, the UI, and every stored claim"
ord: 211
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f954-aa3c-70ce-a619-a0aecf5e0c55",
    "status": "done"
  }
---
Operator's order: the claim concept no longer exists. Remove the `#claim` tag from shipped catalogs and every graph, the `claim` role and the `core/evidence` / `core/truth` contracts, `verify_block` / `unverify_block` and the stamp, source measurement (fingerprints, baselines, probe readers, the measure worker's source reads) and the doctor checks that exist only for claims, claims in the touch road, close-into-claims (`by`) on a spec, claims in briefs, prompts, skills and the UI. Sources stay as plain addresses where non-claim nodes need them (territory, owner lookup). One migration deletes every claim node with its sources, findings, edges, references and journal rows in every store.

Where to start: `graph/contract/wire/tags/declaration.ts` (roles), `catalogs/contract/wire/codeProject.ts`, `graph/sources/`, `graph/measure/`, `graph/orientation/touches.ts`.

Done when: no claim role, tag, verify operation or source measurement remains in server, app, catalogs or prompts; the migration has removed stored claims; server and app typecheck clean; the remaining doctor, touch-road and ownership contracts have passing tests.