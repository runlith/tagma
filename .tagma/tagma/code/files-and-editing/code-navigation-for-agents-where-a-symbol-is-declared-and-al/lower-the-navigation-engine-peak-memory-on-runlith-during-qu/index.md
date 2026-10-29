---
id: 01a161b5-a49c-7507-9b1e-b23c1588ddf7
title: Lower the navigation engine peak memory on runlith during question series, with no multi-second pauses back
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16167-afd2-77b1-bc67-9aa426ed792e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16160-39ce-7163-bb84-009b753b9d92
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
Spec acceptance requires engine memory on a runlith-sized checkout markedly below the previous 3.2–4.5 GB; the built adapter holds 2.4–2.6 GB after load but 4.0–5.8 GB during question series ([[afeadae2]]). Find where the peak goes and remove it at its owner: how many programs are actually loaded and how many checkers live per one — the TS 7 pool holds up to three temporary reference-search checkers plus the standing API checker, and if the adapter goes through both the language service and the checker API, one program's type caches lie duplicated; parallel checkers from batched requests; held snapshots; `GOGC` and `GOMEMLIMIT` (2–2.5 GiB choke the engine with garbage collection, 4 GiB without slowdown). The result is the peak number on runlith after the fix, with answer times by state no worse than previous measurements.
