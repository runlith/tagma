---
id: 01a151d7-04ae-72ae-8657-3b6730f07429
title: After key removal an open thread shows the removed model until page reload
ord: 20
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a151cd-c1e3-7205-b318-fbf3f76a8a50
---
Found while checking f76a8a50 on tagma:try: after saving a DeepSeek key and deleting it, the already-open thread's composer kept showing the DeepSeek model until the page was reloaded. Find the thread's model owner in the client and why it does not learn the provider is disconnected; proof is a test on switching the connected-provider set.
