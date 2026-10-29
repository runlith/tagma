---
id: 01a1182a-46a1-7b0c-bbb5-9e37de193c54
title: An external document change applies outside undo history
ord: 1
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/code-editor
---
A disk, agent or rebase edit goes in a transaction with addToHistory: false and remote; Cmd+Z undoes only the operator's edits.
