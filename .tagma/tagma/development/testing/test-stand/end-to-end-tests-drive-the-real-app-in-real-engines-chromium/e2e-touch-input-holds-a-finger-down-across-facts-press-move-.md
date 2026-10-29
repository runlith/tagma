---
id: 01a18456-7235-7c5f-b458-64abcdc59b7d
title: "E2E touch input holds a finger down across facts: press, move, rest, move, release as one trusted touch on Chromium and iOS"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18358-6882-7146-96af-279f8f0fbb3e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18353-4910-704e-8b7d-d7f17111dc21
  - kind: relates
    to: 01a18353-fb8c-7866-916b-78b406aa5d8d
sources:
  - kind: dir
    ref: packages/e2e/src
---
The feed's most important phone case — older history landing while the reader's finger is still on the screen — needs a touch that stays down while the test waits for a fact. The kit now supplies a scoped trusted contact through Chromium CDP and a persistent native companion HID stream; iOS keeps CSS-to-native mapping in its adapter and explicitly sends UP before completing the stream. One contract in the e2e kit — press at a page point, move along a path, rest, move again, release — trusted on every lane that has touch: Chromium through `Input.dispatchTouchEvent`, iOS through the companion's HID touch down/move/up if it exposes them (else the nearest trusted native equivalent, named). Desktop WebKit has no finger; its page-under-input case stays the wheel. The feed stand's drag-page scenario is its first consumer.