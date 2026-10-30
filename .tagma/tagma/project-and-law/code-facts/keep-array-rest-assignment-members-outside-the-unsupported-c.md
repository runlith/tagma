---
id: 01a18a46-5375-7b6c-b3a9-ee23d9beb94b
title: Keep array-rest assignment members outside the unsupported compiler binding API
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15eb-7a51-a5e5-75762f658f69",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18619-0f3e-74ff-b563-2b8c8e3aead2
---
Prevent the symbol reader from passing object assignment patterns nested in array rests to TypeScript's unsupported destructuring-property API. Preserve unresolved member uses for the existing conservative dependency analysis, and prove the reported Svelte slice lands without carrying its independent peer edit.