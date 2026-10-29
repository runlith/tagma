---
id: 01a0c71c-b96c-7381-adc9-1bbfe264ca01
title: "Open the request's app before any load runs: the server's holder refuses to open it itself"
ord: 29
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/layer/src/request
  - kind: symbol
    ref: packages/layer/src/request/node.ts
    symbol: holdApp
  - kind: symbol
    ref: packages/layer/src/request/node.ts
    symbol: withRequestApp
---
The App opens and closes together with the request in the hook; withRequestApp closes only the app it was passed.
