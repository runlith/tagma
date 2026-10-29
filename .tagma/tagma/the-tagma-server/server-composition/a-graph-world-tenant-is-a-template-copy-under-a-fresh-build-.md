---
id: 01a16c19-6526-7675-89df-de941b5ffd68
title: "A graph-world tenant is a template copy under a fresh build of store-dependent layers on a shared pool: one layer graph per world would hand the test the previous tenant's caches"
ord: 35
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graphFixture.ts
---
The graph world builds once per worker and holds:
- a keep-mode SQLite pool — its writers, reader lanes, and checkpoint outlive tenants, while the kit's guard holds the processes;
- homes by tenant kind: a set of projects and repositories, a source, and a preparation. Each home holds a template — the store and project catalogs after the first assembly.

The preparation kind is its function's identity within the worker. A shared helper module gives all its files one template, while different files' inline preparations give different templates.

A tenant is a template copy into a home plus a fresh build of the store-dependent layer-graph strata on the pool's writer. It raises no new SQLite processes, and launches no git either. One home serves one tenant at a time: a second concurrent tenant of the same kind builds its own home and its own template.

**Why the layer graph is not one per world.** Graph services hold per-project and per-registry-revision state: tag tables, `SourceProject` places, the journal and feed, search, block names. Swapping the store data under one built graph would hand the test the previous tenant's caches. Making that safe would need a reset at dozens of product owners, though the product itself never changes data under a running server and holds no defect there. A fresh project per tenant in the shared graph breaks tests naming `demo` or listing projects. Besides, birthing a project costs more than the current opening.
