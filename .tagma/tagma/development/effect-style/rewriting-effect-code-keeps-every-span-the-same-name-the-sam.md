---
id: 01a13b99-156f-79a6-8ebb-481bc33e5cbc
title: "Rewriting Effect code keeps every span: the same name, the same place in the tree, the same attributes"
ord: 7
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/src
  - kind: dir
    ref: packages
---
`.pipe(Effect.withSpan('X'))` becomes `Effect.fn('X')`, not fnUntraced. FnUntraced is only a cheap helper with no own IO, process, SQL, network or waiting. Renaming or deleting a span is a separate decision in the commit, updating all readers of the old name in the same change.
