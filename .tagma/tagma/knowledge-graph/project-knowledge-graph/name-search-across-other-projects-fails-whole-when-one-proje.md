---
id: 01a130b1-3025-72df-8362-e0fc75aed34e
title: Name search across other projects fails whole when one project is unreachable
ord: 229
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1205b-860f-7204-8ede-30bea586c5d8",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/crossing.ts
---
`graph/operations/crossing.ts` `elsewhere` (~53–69): one foreign project's reach refusal drops name search over all of them. The operator's principle: a broken, old or unreachable copy doesn't break work with the current one — the failure is isolated in its copy and named in the answer (typed partial), the rest answers as usual. The model is `globalNames`, which already answers reach(global) as unreachable. Done: a test with one unreachable project — search finds the name in the rest and names the unreachable one.
