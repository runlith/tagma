---
id: 01a0e9e2-3fb6-7990-842e-b08481ca3b55
title: "held: a hold's ceiling follows the work it covers, so an O(size) section such as a git index write is not cut on a large checkout or a slow disk"
ord: 93
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
---
`Held.declare` takes only a static ceiling. `platform/git/settle.ts`'s `indexSection` holds for at most 1 s, but one changed-entry index write is O(serialized index size), so on a large checkout or a slower disk the hold is cut even though nothing is wrong. That breaks rule fe83acfa: the limit comes from this machine, not from the range the product has to serve.

Target: a section may declare its ceiling as a function of a size it states at the call. For example, a base plus bytes over a throughput that is derived once per machine. The ceiling is computed per hold, and the hold still refuses a caller that states no size. Callers that hold for a fixed amount of work keep a static ceiling.

Done when `held` offers the sized ceiling with unit tests, `indexSection` uses it with the index file's size, and the `held-resources` inspection still recognises both forms. Found by wave-landing during [[d17d5204]].