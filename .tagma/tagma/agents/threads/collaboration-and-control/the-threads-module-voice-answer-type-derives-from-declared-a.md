---
id: 01a141c3-c890-7056-a490-83c4e03c4fce
title: The threads module voice answer type derives from declared answer operations instead of being handwritten in ThreadToolAnswer
ord: 20
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a141b9-f42f-7c10-8b77-e5d96c03d016
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/evidenceInput.ts
  - kind: file
    ref: apps/tagma/server/src/threads/voice/display.ts
---
`ThreadToolAnswer` (`threads/contract/wire/evidenceInput.ts`) is handwritten, while the threads module's presentation (`threads/presentation.ts`) casts every one of its operations' answers to it without its own voice or display. The `threadSettledDisplay`/`threadToolText` branches tell forms apart by `status` and fields, so an operation with a busy status falls into someone else's branch: that is how `set_thread_transport` wrote a `delegation` fact without `value` and dropped the turn (fixed pointwise in ceebd89cb1). An answer without its own branch (`move_thread`, `set_thread_operator_notice`, `set_thread_title`) gets `UNVOICED` from voice and no projection from display, but matching still goes by shape.

To do: the answer voice type derives from the registry's declared `answer` operations, and display and text match exhaustively by operation, not by `status`. Done when adding an operation to the module's presentation without its form no longer compiles.
