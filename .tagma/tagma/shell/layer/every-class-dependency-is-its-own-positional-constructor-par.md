---
id: 01a13aed-9dc3-7764-82ab-4f90c826fe6a
title: Every class dependency is its own positional constructor parameter; the options object goes last and carries only optional values
ord: 34
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/app/src
  - kind: dir
    ref: packages/i18n/src
  - kind: dir
    ref: packages/layer/src
  - kind: dir
    ref: packages/primitives/src
  - kind: dir
    ref: packages/query/src
---
Use parameter properties; a static make() resolves the dependencies and passes each to its place. XDeps bags, constructor(deps: {...}) and this.deps.api are forbidden.
