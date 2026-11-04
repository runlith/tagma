---
id: 01a13652-330d-7a89-9623-245c1553d478
title: A program fails on unread bytes only when it asks for their text; a linter reads its declared reach
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/bindings.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/files.ts
---
A program's parameters are its own dictionary: the server knows its reach through the rule's places and the description's `files` globs. Changed regular files inside that reach are offered as paths; the input batches readable text and retains each unread path's reason. Only `side.read(path)` makes that reason a failure of the program key asking for it. Otherwise an unrelated binary asset would prevent a checker from judging its source files. A failed key does not erase successful readings from other keys sharing its process. Symlink and gitlink entries are not offered as source files.

A linter consumes the files in its declared reach, so unread bytes there fail its adapter before launch. A program must select the paths its checker reads before asking for text; `files` can narrow those candidates at declaration time. Findings outside the declared reach are discarded, so narrowing it beyond what the checker judges loses violations.