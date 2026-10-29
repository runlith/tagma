---
id: 01a13fef-7b30-744c-a55c-cf07464d97d8
title: The CLI cache key keeps fractional mtime via native async stat
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13fe3-90d8-702f-abf2-07f11526386b
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/birth/installed.ts
    symbol: makeInstalledHarnesses
---
In Effect 4.0.1, FileSystem reports mtime as a Date with whole milliseconds; the installed-CLI key must tell apart rewrites of the same size inside one millisecond. So the fingerprint uses native async stat with fractional mtimeMs, while realPath and the neighbouring runtime check stay on FileSystem. Lost precision would leave the replaced CLI in memory until refresh.
