---
id: 01a18a48-2de9-73da-a0e2-f81aaae1c74a
title: Keep a confirmed task open when an older unread expiry arrives
ord: 206
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3d-4587-782b-8f41-83c488f67465",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1662e-e378-79a1-9024-e309bc7dc271
---
Make the adapter report owner expire only words still unconfirmed for the addressed run. A confirmed task remains owed even though its inbox state stays delivered, and a delayed unread expiry must neither close it nor send a false report. Prove the public AdapterReports scenario before and after the fix; historical process loss remains separately unverified.