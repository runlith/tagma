---
id: 01a1805f-e85d-7e67-8f69-9fcbe7c2a9bb
title: "A block is born into stealth or team storage: storage at create, set_block_storage, and op storage in batch; reads answer storage"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18045-d0e1-7f6a-b44e-0cf66973f046",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1805a-1f26-7e78-975f-db2cccba6116
  - kind: waits-on
    to: 01a1805f-e85d-7e67-8f69-9fca40a22264
---
The spec's acts and reads over two trees: the storage choice at birth, subtree transfer, storage in `read_block`, `query_blocks` and `search_blocks` rows, and storage-based selection in `query_blocks`.
