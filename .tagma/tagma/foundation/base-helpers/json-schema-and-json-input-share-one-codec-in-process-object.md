---
id: 01a1286c-87ab-793e-8d43-51641354bedb
title: JSON Schema and JSON input share one codec; in-process objects keep the typed form
ord: 17
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/utils/src/codec.ts
---
The JSON boundary decodes Effect's canonical form with the same schema it publishes the JSON Schema with: `Schema.optional` receives `null` from JSON as `undefined`, while exact nullable and patch fields keep their distinction. The codec is cached weakly by schema instance: repeat calls and catalogs do not rebuild it and do not retain removed schemas. In-process object passing stays on the typed codec; model-dialect handles only forms outside the JSON contract.
