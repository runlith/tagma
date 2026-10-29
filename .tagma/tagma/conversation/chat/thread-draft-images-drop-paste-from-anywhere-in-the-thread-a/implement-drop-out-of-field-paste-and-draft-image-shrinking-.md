---
id: 01a101c2-fb1c-7c9b-83c7-b803943b952f
title: Implement drop, out-of-field paste, and draft-image shrinking in chat-ui and missed-drop protection in the Tagma app
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a101ad-7536-73f6-b50c-adb7fadd5ece",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a101c2-edb6-7825-b139-46367efb2db4
---
Do what the spec describes, in full: `draftImages.ts`, the new `imageIntake.svelte.ts`, `ChatSurface.svelte`, `Composer.svelte`, `DraftImageStrip.svelte`, and the Tagma app root layout. The work is done when the spec's acceptance items pass.
