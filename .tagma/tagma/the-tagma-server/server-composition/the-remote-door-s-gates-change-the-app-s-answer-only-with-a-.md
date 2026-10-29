---
id: 01a10cae-f9af-7321-b709-248d282713c0
title: "The remote door's gates change the app's answer only with a pre-response handler: server middleware gets that answer already sent"
ord: 36
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a10c98-bb9c-71b7-935b-be450ef5e0d1
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/remote.ts
---
In Effect 4.0.1 `HttpRouter.serve(app, { middleware })` sends the app's response while still inside the middleware (`HttpEffect.toHandled`: `sendResponse` sits in `responded`) and marks the request answered. The response the middleware returns on top is dropped. So the remote door's gates put headers and the extended `/health` cookie on the app's answers only through `HttpEffect.appendPreResponseHandler`. For the app that means `frame-ancestors 'none'` and `X-Frame-Options: DENY`, and for pages under `/a/` — `frame-ancestors 'self'` and `SAMEORIGIN`: the card of a published page in the feed frames it from the app of the same door. The page's `sandbox` CSP does not get in the way: `'self'` is checked against the answer's origin, not the opaque origin of its document (checked once in headless Chromium and WebKit of Playwright 1.60 builds: the frame loads, `postMessage` travels both ways with origin `"null"`). The gates change their own answers — the shell, refusals, and the code exchange — directly, because the pre-response handler does not apply to them.

Editing the returned answer with `Effect.map` looks working and passes typecheck, but never reaches the browser.
