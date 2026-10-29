---
id: 01a0ca5e-42ae-75e6-9b03-c5e49291b090
title: Write the claims of the rows, one per kind of entry
ord: 158
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Read `packages/chat-ui/src/entries/` — every component except the patch reader — plus `AttachedDocBody.svelte` and `ImageViewer.svelte`. Write the claims under [[9c45ce82]]; the module is [[cb732496]].

What is claimable: which face a row wears and what decides it, what the shared pieces guarantee every row that uses them (the collapse, the meta row, the attachment strip, the disclosure), and what a product replacing a row by name still gets for free — the x-ray is mounted under every tool renderer, the package's and a product's alike. Do not write the patch reader [[da6799af]] or the question row [[b703274b]]: both have tasks of their own.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. This is Svelte 5: load the `svelte5` skill first, so runes, snippets and attachments are read as what they are. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.