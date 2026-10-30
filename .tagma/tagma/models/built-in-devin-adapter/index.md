---
id: 01a12c56-9124-7319-834e-660cd644f1c5
title: Built-in Devin adapter
ord: 29
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter.ts"
      },
      {
        "at": "src/models/"
      },
      {
        "at": "src/icon.ts"
      },
      {
        "at": "src/harness/devin.ts"
      }
    ],
    "id": "@runlith/adapter-devin"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
sources:
  - kind: dir
    ref: packages/adapter-devin
---
Devin models and chats are declared together by this built-in adapter: the CLI's terminal surface, hook replies, ATIF metadata and vendor-run ACP profile belong to the package, while the server owns transport driving and thread state. The vendor's program and sign-in remain Devin's.