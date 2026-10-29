---
id: 01a15a0f-b733-756b-919f-1beff6440baf
title: A menu called from the image-view modal draws inside its `<dialog>`, otherwise the top layer covers it
ord: 54
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a15a04-9ad4-7f2a-86d0-a241ef615162
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ImageMenu.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/dropdown-menu/dropdown-menu-content.svelte
  - kind: file
    ref: packages/chat-ui/src/ImageViewer.svelte
---
A chat image in the thread viewer is drawn on a `<dialog>` opened with `showModal()`: it stands in the browser top layer, and everything outside it is inert while it is open. The app dropdown menu is portalled by default into the shared overlay root outside the dialog, where it would sit under the modal and take no presses. So the image menu call passes the dialog element, and `DropdownMenu.Content` takes it as the portal target.

Escape with the menu open closes only the menu: the layer stack absorbs keydown via preventDefault, and the dialog gets no close request. A menu called from the feed passes `null` and goes to the shared root as before.
