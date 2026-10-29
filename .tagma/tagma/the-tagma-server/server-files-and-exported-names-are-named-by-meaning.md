---
id: 01a0e9ce-1cb6-720d-8abc-c6e5931cfbf1
title: Server files and exported names are named by meaning
ord: 64
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/src
---
In `apps/tagma/server/src`, except tests:
- a file isn't named after its folder or its singular (`threads/thread.ts`); the exception is a module's main file `<module>/<module>.ts`;
- a file name doesn't start with a word from its folder's name (`threads/threadStore.ts` → `threads/store.ts`);
- a one-word plural file name (`helpers.ts`, `utils.ts`) — only for a short file about one subject;
- an exported name doesn't start with the product name (`TagmaX`; `TagmaApp` is the one exception) and doesn't end with an empty word (`Data`, `Info`, `Helper`, `Manager`, `Service`);
- one exported type is declared in a module once;
- an error class is named by the condition that happened (`…NotFound`, `…Refused`), not a generic `…Error`;
- a service key is named `<module>/<Name>`;
- graph code doesn't write catalog tag names as string literals (`'task'`, `'rule'`) where a tag is needed.

A violation is a reason to rename, move or split the file by subject — not to game the count.
