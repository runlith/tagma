---
id: 01a0c6fd-cc0a-7c07-b38f-7208a634d262
title: The route key given to the error boundary carries no query string, hash or localized text
ord: 3
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: file
    ref: packages/error-boundary/src/fingerprint.ts
---
It is part of the fingerprint that groups repeated errors; any variable part splits one error into many.