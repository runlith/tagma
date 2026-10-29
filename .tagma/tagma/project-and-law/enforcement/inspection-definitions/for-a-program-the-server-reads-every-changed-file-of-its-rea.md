---
id: 01a13652-330d-7a89-9623-245c1553d478
title: For a program the server reads every changed file of its reach as UTF-8 text, so the program description in `tagma.config.ts` declares `files` by what it reads
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/bindings.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/files.ts
---
A program's parameters are its own dictionary, the server doesn't see them: it only knows what the program reads from the reach — the rule's places and the `files` globs of its description in `tagma.config.ts`. Every changed path inside the reach the server reads and hands to the program as text, and a path whose bytes aren't UTF-8 fails the judgment: the program could have read it, and silently skipping would pass a broken source as clean. Symlink and gitlink aren't sources — a symlink blob stores the target path, not text — so they aren't read or passed; a file a symlink points to is judged itself when it changed.

A description without `files` thereby claims the rule's whole region, and a binary file anywhere in it — an icon, a tiff, a `.DS_Store` — refuses `inspection-failed` even when the program never opens it. The right answer is `files` naming exactly what the program reads (for migrations: `.ts` sources under `source` and everything under `folder`), not loosening the read. Findings outside reach are dropped, so `files` already past what the program judges would lose violations.
