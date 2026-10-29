---
id: 01a175e1-b116-7055-8be6-30fe2282b5b0
title: "Cut puts each architecture's app in its own DMG: Tagma-<v>-arm64.dmg and Tagma-<v>-x64.dmg"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a175e2-d7b9-7514-a0a5-c35770bf654e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a175e1-b116-7055-8be6-30f9fb401399
  - kind: waits-on
    to: 01a175e1-b116-7055-8be6-30fd6e4a06fd
---
Cut puts each thin `Tagma.app` in its own DMG — `Tagma-<v>-arm64.dmg` and `Tagma-<v>-x64.dmg` — with the same window and signature as now. The cut record carries each platform's DMG beside its archive, `publish` uploads both DMGs, notarization sends and staples two apps and two DMGs. No universal app — the operator's decision.
