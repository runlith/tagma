---
id: 01a15a3c-8c84-769e-9375-1eb0c8523b68
title: The Rules place on the rail and in "…" marks unviewed escaped violations
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a15a02-4fdb-7009-a8f6-3748f4e52ddd
---
The Rules screen mockup promised a dot on the Rules place while there are escaped violations the operator hasn't seen. Built without it. The rail (`app/chrome/RailPlaces.svelte`) is app tier and knows places only from `SurfaceRegistry`, while the escape count lives in the `RulesRepo` graph tier. What is needed is an attention port on the surface declaration, filled by the feature, and a "viewed" mark per project when the screen opens, without the rail importing rules.

Proof: a new escape with another screen open sets the dot, opening Rules clears it, the state survives a reload.
