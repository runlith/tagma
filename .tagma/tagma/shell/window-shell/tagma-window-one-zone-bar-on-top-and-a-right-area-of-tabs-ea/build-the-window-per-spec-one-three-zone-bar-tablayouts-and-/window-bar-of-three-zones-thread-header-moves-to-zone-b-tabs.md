---
id: 01a15644-1e62-737e-8e6e-ed9f2ffc23d3
title: "Window bar of three zones: thread header moves to zone B, tabs to zone C, narrow window, sections, and ⌘I in Checkout"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15631-0832-7cc5-a462-4d49c954c2cd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15622-e2ef-7840-b59b-5e32e200e09f
---
Part of [[e200e09f]]: `TopBar` is built in A/B/C zones by window column, `Header` as a bar is deleted, its elements move to zone B and the title menu, zone-B contributions are owned by the section, the tab bar and global buttons stand in zone C or at the end of B, the wide search field goes away, a search icon in zone A. Proof is typecheck and demo build.
