---
id: 01a194c6-01dc-72dd-aefd-49b62e469bd6
title: Git visibility keeps the requested spelling and confirms Unicode aliases against directory entries
ord: 113
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/git/src/entries.ts
    symbol: visibleAmong
---
Git may precompose a working filename while a recorded write keeps the filesystem spelling it addressed. Visibility answers the requested paths, using normalization only to find possible aliases and the physical directory entry to establish identity; distinct names on a normalization-sensitive filesystem stay distinct. Enumeration remains limited to the named paths, split by command-line weight, and reads without fsmonitor so an unseen write cannot become Outside git.