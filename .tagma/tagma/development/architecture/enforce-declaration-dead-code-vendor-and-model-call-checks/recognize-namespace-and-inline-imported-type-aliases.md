---
id: 01a18ec4-80a3-7432-b4bb-a82b5d22ff8f
title: Recognize namespace and inline imported type aliases
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e91-0057-7f4b-85b6-a35adafffddb",
    "status": "done"
  }
---
The shared-type inspection recognizes only aliases whose target is an imported identifier. Namespace-qualified and inline import types name the same foreign declaration but evade that case; prove both through the public inspection and retain projections and generic applications as clean.