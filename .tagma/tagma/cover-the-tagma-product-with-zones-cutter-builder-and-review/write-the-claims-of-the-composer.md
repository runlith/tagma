---
id: 01a0ca5e-42c8-77a1-9994-4acdfc90a329
title: Write the claims of the composer
ord: 163
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
Read `packages/chat-ui/src/Composer.svelte`, `ComposerDock.svelte`, `ComposerFrame.svelte`, `ComposerMenu.svelte.ts`, `ChatComposerOverlay.svelte`, `composer.ts`, `composerFrame.ts`, `composerKeys.ts`, `PromptField.svelte`, with their four test files. Write the claims under [[7b8a2552]]; the module is [[cb732496]].

What is claimable: which keys send, recall and dismiss and what each does when a menu is open, how a slash verb with arguments is collected and who executes it — the composer collects and the host is the only executor — what an @-mention pick does to the draft, and which zones a product fills. The frame constants are the one place this package writes class strings outside markup; the exported input class exists so a product filling the input slot draws the same box.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. This is Svelte 5: load the `svelte5` skill first, so runes, snippets and attachments are read as what they are. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.