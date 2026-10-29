---
id: 01a116c4-468e-72ed-91b5-fa2a09fbaa34
title: The working form is read through raw oids; filters apply by path, replace objects ignored
ord: 106
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/heads.ts
  - kind: file
    ref: packages/git/src/objects.ts
  - kind: file
    ref: packages/git/src/treePaths.ts
  - kind: file
    ref: packages/git/src/working.ts
---
Raw `cat-file --batch` has exact byte framing; the `--filters` variant prints the raw size and so cannot split converted bodies. The reader resolves revision paths through touched tree objects, and rereads the index. The Holdings base metadata is read with the same `GIT_NO_REPLACE_OBJECTS=1`: otherwise a tree replace would change authorship base while its blob was read raw, and a plain insert would look like someone else's replacement. Its paths are relative to the call directory even below the Git root: the qualified root `oid:./` is resolved by git in the same batch session, with no cache on that request's line. The decoder keeps U+FEFF: at a name start it is part of the path, not a text-document BOM. Raw objects share a byte-bounded cache by object storage and oid; `GIT_NO_REPLACE_OBJECTS=1` makes this key immutable, so this reader never sees replace objects. Attributes and config are read fresh, converted bytes are never cached: one oid under different paths gives different working forms. The answer is never carried from batch to batch of one landing: between them a peer may change `.gitattributes`, `.gitignore`, `info/attributes`, config or its include, and publishing the index changes the attribute source when `.gitattributes` is missing on disk (git then reads it from the index). Revision cost is O(1 + k) processes, index O(batches of argv + k), where k is paths with conversion. Sessions belong to the Git service scope; a framing error closes the session, the next request may start a new one. A path error stays its own result and never turns neighbours into absence.
