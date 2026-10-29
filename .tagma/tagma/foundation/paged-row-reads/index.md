---
id: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
title: Paged row reads
ord: 4
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/pages.ts"
      }
    ],
    "id": "@runlith/paging",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
sources:
  - kind: dir
    ref: packages/paging
---
Reads that answer with rows give a page with a cursor and a shared total, and the package gives them one mechanism: a cursor bound to its question, and a family of pages with a default size and ceiling derived from row size. A walk declares its selection and key schemas: by them the package restores the selection from the cursor supplied without narrowing and hands the reader a typed position, past which it reads no more than a page plus a probe row. What to read and in what order is the reader's call; a growing selection it reads at its store by key.
