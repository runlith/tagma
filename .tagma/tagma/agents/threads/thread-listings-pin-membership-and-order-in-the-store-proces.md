---
id: 01a188a1-5f12-7fb3-b665-c0bca666743a
title: Thread listings pin membership and order in the store process and carry a selection handle
ord: 136
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/active.ts
---
A listing must keep its membership and order when activity arrives, clocks move, or a thread is archived between pages, without putting the matched population into the server heap or continuation. Metadata and activity have separate stores, so the thread-list owner intersects activity candidates with metadata filters in bounded batches and retains the ordered result in the machine store's temporary tables; only a requested page crosses back. Constructing the exact total still visits the matching population asynchronously. An indexed position keeps each continuation independent of pages already read. Construction checks the still-held selection under the same writer transaction as its batch, so eviction cannot leave a builder's later rows behind; failed construction releases its partial state. The held selection belongs to that store connection and leaves on restart or when displaced by newer readings; its continuation then requires a new question. Row details are current, so an archived pinned member still appears and a deleted member consumes its original position.