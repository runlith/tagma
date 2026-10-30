---
id: 01a0c71c-b96c-7381-adc9-1bbfe264ca01
title: On the server a request's app is opened by the hook before any load runs; `holdApp` never opens one
ord: 29
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/layer/src/request/node.ts
    symbol: holdApp
  - kind: symbol
    ref: packages/layer/src/request/node.ts
    symbol: withRequestApp
---
`holdApp` throws when no request app is open. `withRequestApp` closes only the app it was handed when the request's run ends, so the hook that opens the app is the one that wraps the request.