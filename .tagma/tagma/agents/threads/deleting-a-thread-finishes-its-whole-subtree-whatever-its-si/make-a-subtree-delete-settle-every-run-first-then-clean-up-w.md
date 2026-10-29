---
id: 01a0f9a9-a30a-726b-8065-b30b8208ec27
title: Make a subtree delete settle every run first, then clean up whole at a cost linear in the subtree, with every refusal declared
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f9aa-8b46-76b9-b807-051bb27d4295",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f9a9-a2ee-78eb-97fc-4b06d5c131db
---
Build [[d5c131db]]. Start at `delete` and `bounded` in `apps/tagma/server/src/threads/ending.ts` and `deleteRow` in `packages/agent/src/thread/run/ThreadAggregate.ts`; measure where a large subtree's time goes on a synthetic fixture before changing it. The `reach` lines of `delete()` are [[c2778bc5]]'s. Done when the spec's acceptance holds and the deletion claims (5a4e04a3, be98b5ae) say what the code does.