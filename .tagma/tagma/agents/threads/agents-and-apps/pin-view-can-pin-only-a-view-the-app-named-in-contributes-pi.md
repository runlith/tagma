---
id: 01a123c2-ecfa-7a66-921d-e30843cdada4
title: pin_view can pin only a view the app named in contributes.pins
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a123b0-f0b8-7505-af77-37f088151d7d
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/operations/pins.ts
  - kind: file
    ref: apps/tagma/server/src/threads/pinOffers.ts
---
`pin_view` pins only a view the app named in `contributes.pins`: threads declares the point because a pin is a thread fact, while `tagma-apps` and `views` know nothing of pinning. A view unnamed in `pins`, and an app that pins nothing, refuse `view-not-pinnable` with a hint where to register it. A manifest where `pins` names a view with no `views` record does not refuse install: the app receives a `failed` row with the reason at start, as with `results`, because point registration runs after schema validation.

Only the view itself is checked at pinning: whether the app is enabled in the project and its process alive is not asked. A pin survives the app being switched off and shows again once it is back.
