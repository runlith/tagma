---
id: 01a13236-cffe-7fb7-b928-80bf04065d19
title: "A move lands as a pair: one move projection serves landing and the court, the selection carries the second path while the source is off disk"
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13236-64ca-761e-999f-75e717872cd0
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/team.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/moves.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
    symbol: probeAt
---
Landing builds a tree from the base and the carried paths, so a move source missing from them would stay in the judged tree as an old copy: the rules would judge its dead imports, and the commit would add the new file without deleting the old one.

Which paths are one move is answered by one `movesAt` projection (`record/moves.ts`), read by both the landing selection and the Holdings `from` of the `read_changes` court. Witnesses are three:
- the record lines' `movedFrom` (the rename tool, a command, the operator's move);
- a deletion and a birth of the same bytes in one holder's lines, even across commands — only with a single pair per digest and contents no shorter than `MOVED_BYTES`: an empty file, a keep-file, or a one-line stub repeats byte-for-byte on its own;
- the index's staged rename, exact only (`--find-renames=100%`): `git mv` puts an unchanged blob in the index, and a similarity pair would drag in someone else's staged deletion of a similar file. The index reads without a pathspec: a git status narrowed to one target never sees the pair.

A pair acts only while the source is off disk; a recreated source is an independent path. Selecting either of the two — in `paths`, by directory, or by the team's rows — takes both, and so does a path joining through the closure; the second path is carried like any file. There is no "land one without the other".
