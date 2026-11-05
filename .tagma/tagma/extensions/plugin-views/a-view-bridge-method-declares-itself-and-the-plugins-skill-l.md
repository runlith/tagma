---
id: 01a195e4-0e2f-798d-ae8b-e1a23a3e6fcc
title: A view bridge method declares itself, and the plugins skill lists the methods of the modules composed in the root
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/methods.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/bridgeMethods.ts
  - kind: file
    ref: apps/tagma/server/src/views/contract/wire/bridge.ts
---
A `tagma/<id>` method of the view bridge is declared once, in wire both sides import: its id, notifications, signature, a description and, where one line is not enough, a reference body. The owning module contributes the declaration to the server's `views/bridge-methods` point through its manifest, and the window registers the same declaration in `TagmaMethods` with the function that serves it; the window's key, capability, claims and admission against the host's own methods come from it. The `plugins` skill is read with `<!-- bridge-methods -->` replaced by the list of the declarations the root composed, and every declared reference is a reference of that skill, so a root without a module does not mention its method and no skill text names a method by hand.

The host's own methods (`open`, `storage/*`, `thread`, `thread/unwatch`) are the `views` module's contribution to the same point. The rendering is the native harness's, applied where it discovers the shipped skills, so the text is read from one place.