---
id: 01a13f34-7d5e-7b23-bc62-3f2c2618aff7
title: bash held the command past waitMs over a vanished obligation
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "Tool said: \"Its wait passed and this call could not move it to the background: This installation owes nothing for 75294070-9f7a-4ad0-916e-5a8903eceb4e; a mode moves only while its obligation stands.; it was held here until it ended.\" The result was delivered after holding to the end; the exact extra duration is absent from the answer.",
    "command": "bash({\"command\":\"git -C .external/effect grep -n -A 10 -B 6 -E 'export const currentTimeMillis:|currentTimeMillisUnsafe: dateNow|currentTimeMillis: sync\\\\(dateNow\\\\)' effect@4.0.1 -- packages/effect/src/internal/effect.ts; git diff --stat -- apps/tagma/server/src/graph\",\"description\":\"Resolve Clock accessor and current review scope\",\"waitMs\":10000})",
    "expected": "Past waitMs, the command moves to background and returns an address, or a finished result returns without holding."
  }
---
Filed from project `runlith`.
