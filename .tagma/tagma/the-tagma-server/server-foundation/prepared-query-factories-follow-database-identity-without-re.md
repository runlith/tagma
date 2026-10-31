---
id: 01a1911d-b959-76c2-9eff-44f8a4d7335b
title: Prepared query factories follow database identity without retaining a closed store
ord: 39
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/queries.ts
---
A fixed SQL shape can be shared by helpers receiving a database without caching any rows. Its owner declares the prepared factory once; the platform memoizes compilation under weak database keys, so a replacement store builds its own statements and a closed store is not retained by the factory. Bindings and execution still run in the invoking unit's context. Program binding carries the prepared SQL and its parameter encoders without building it again. A placeholder predicate over an encoded column must retain that column's parameter encoder: a bare placeholder passes its value unchanged and can otherwise send a Date or JSON object to SQLite.