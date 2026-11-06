---
id: 01a18504-d968-7ee8-87c2-5df78994dad2
title: Framework metadata is inspected in the main world without enabling Runtime
ord: 29
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/source.ts
---
Framework inspection requires fast input because it executes in the page's main world; human profiles refuse element picking before that work starts. Framework expandos belong to the page's main-world DOM wrappers, so the isolated automation world cannot read them. The pick resolves a main-world object and prepares an inspector-private reader under CDP's side-effect check, without enumerating property values through the inspector. The reader captures only bounded metadata and, for an unformatted React Error, its native getter; it invokes that getter only when descriptor checks find no own or inherited formatting hook. The reader and its handles leave with the pick's object group, and no binding or expando is installed in the page.