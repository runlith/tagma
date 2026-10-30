---
id: 01a0caa5-45e0-70e5-960a-197e9ed581b5
title: An `onItem` handler passed to a live `hold` settles and never rejects
ord: 1
tags: ["rule"]
sources:
  - kind: symbol
    ref: apps/tagma/app/src/lib/wire/Live.ts
    symbol: hold
---
Its promise settles after the item is handled, with success or with the refusal shown to the consumer.