---
id: 01a0ca5e-42b3-7ac9-b86b-0475ac287d47
title: Write the claims of the patch a reader meets
ord: 159
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
Read `packages/chat-ui/src/entries/ToolDiff.svelte`, `DiffMap.svelte`, `DiffRow.svelte`, `diffPieces.ts`, `diffState.ts`, `patchRows.ts`, `mapGeometry.ts`, `mapPicture.ts`, with their five test files beside them. Write the claims under [[da6799af]]; the module is [[cb732496]].

This is the one patch reader in the repository and it is published: a product mounts it outside a chat as well as inside one. What is claimable: the rungs that decide what a patch is drawable as before any row is made, the ceilings each rung stands at, how the highlighting port is asked and what an answer that never comes leaves on screen, and what the miniature is and is not painted from. The patch parsing itself is `@runlith/utils` [[382fa6aa]] — read its claims rather than restating them.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. This is Svelte 5: load the `svelte5` skill first. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.