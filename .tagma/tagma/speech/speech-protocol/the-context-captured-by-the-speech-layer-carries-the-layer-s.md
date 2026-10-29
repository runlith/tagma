---
id: 01a106e0-2c78-7aed-94f3-4b455e61dd2c
title: The context captured by the `Speech` layer carries the layer's `Scope`; a provider call gets the caller's scope through `within`
ord: 4
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/speech/src/engine/access.ts
    symbol: within
---
`Speech.layer` captures the context at build time to hand providers their requirements, and `Effect.context` returns it whole, layer `Scope` included. Giving the provider this context over the segment's scope lets the inner `Scope` win: the connection and its opening live until the layer ends, and a `stop` during opening leaves a live connection. `within` places the caller's scope into the captured context, so the connection, detector and synthesis close together with the segment or session.
