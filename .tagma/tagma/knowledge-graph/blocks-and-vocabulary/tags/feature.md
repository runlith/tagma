---
id: 01a14b92-358d-7123-b0fb-ddbce6940113
title: "#feature"
ord: 16
tags: ["tag"]
fields:
  {
    "body": {
      "shape": "content"
    },
    "edges": [
      "validates",
      "relates"
    ],
    "fields": {
      "state": {
        "type": "enum",
        "values": [
          "live",
          "partial",
          "dormant",
          "promised"
        ]
      }
    },
    "id": "feature",
    "sources": [
      "file",
      "dir",
      "symbol"
    ]
  }
---
A #feature is one capability the product gives a user or an agent, titled in the product's words — "an agent starts a child on any model", not "spawn door" — so the product can be understood, compared and planned. The body, short: **Value** — the problem it removes and for whom; **How** — what reaches it, named, not specified; **Behaviour** — the non-obvious conditions; **Limits** — where it ends, in words. Parameters, refusal codes, interface strings and numbers stay with their owner. `state`: live; partial — the gap named; dormant — built, unreachable; promised — said, not done. One capability of one weight per record: a detail is a sentence, a related feature a `relates` edge. Sources name the code carrying it; a change breaking its words corrects it in the same commit, and a discrepancy with the code is named, never smoothed over.
