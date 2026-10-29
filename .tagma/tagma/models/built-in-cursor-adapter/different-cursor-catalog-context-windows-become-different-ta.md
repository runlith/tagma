---
id: 01a1645e-127e-750e-84a1-15be1f826ece
title: Different Cursor catalog context windows become different Tagma models
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/adapter-cursor/src/catalog.ts
  - kind: file
    ref: packages/adapter-cursor/src/selection.ts
---
The Tagma window is static by model, so context cannot stay a switch next to fast or thinking. The projection keeps Cursor's exact value in a separate Tagma model id; the shared selector returns it in params at launch. Aliases serve reading a saved choice and lead to the default context variant. With no param, only windows checked against Cursor docs are allowed: an unknown model stays a catalog warning, not an invented capacity.
