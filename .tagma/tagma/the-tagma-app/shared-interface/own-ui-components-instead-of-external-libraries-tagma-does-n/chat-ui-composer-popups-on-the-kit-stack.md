---
id: 01a13d48-9aa9-71d0-a2d8-6907e8193bf0
title: chat-ui composer popups on the kit stack
ord: 12
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
`packages/chat-ui` draws its panels above the input field with absolute positioning in the page flow (`Composer.svelte:446,455`, `ComposerMenuPopup.svelte:37`). On the kit stack from [[313c7343]] they would get shared depth, closing, and placement.

Cost — chat-ui depending on the kit and editing its boundaries. First it must be decided whether chat-ui should know the overlays kit at all.
