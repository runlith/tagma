---
id: 01a1271e-2479-7971-9b0c-4ed2abc8c9fc
title: Orphaned logic hands fd to a new holder
ord: 13
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Per the spec, logic that lost its holder serves live executions to the end and closes new starts: no new terminals and no host change until the last old one ends. The logic could raise a new holder and hand it copies of fd and the claim. It would not get kinship and exit statuses back (`ECHILD`), but new starts and updates would stop waiting for the end of old executions.

The fact is needed: whether the holder actually falls, and how long executions live after such a fall. With no such case this is machinery against a threat nobody has seen ([[06e41b6f]]).
