---
id: 01a18d61-e9fc-70f8-b28a-6336903c6f97
title: Declaration inspections judge a commit from its changed files over a blob-keyed index; the whole tree is read only on remeasure
ord: 28
tags: ["explanation"]
sources:
  - kind: dir
    ref: checks/law/declarations
---
The facts of a source file — its exports, imports, uses and type shapes — are a function of its git blob alone, so `database.ts` keeps them per blob in `<git-common-dir>/runlith-law/declarations.sqlite`, next to the places a blob stands at and the import links and shape keys that find importers and copies. The index resets whenever a file that defines it changes; a missing or reset index is rebuilt from the tree being judged, never an error.

A commit is judged from its changed files, not from the tree: `git diff-tree` names the changes, the links and shapes tables find the candidate importers or copies, and each candidate is verified against the judged commit before its facts are read, so the cost follows the change. The price is that an importer outside the change counts as live. Code reached only through dead code in files the commit did not touch, and exports left unused by a removal in another file, are therefore reported by the remeasure alone, which reads the whole tree and answers `covered: 'reach'`. Both readings use the same finding functions and the same fingerprints, so on the files a commit changes it finds a subset of what the remeasure finds there.

Fingerprints name the shape or export and the file, never a line, so an edit above a declaration keeps its debt; each file of a repeated group carries its own finding, so a new copy is a new violation and the older copies stay in the debt. Test files, `testing` folders and declaration files are matched by the `tests` globs and are neither consumers nor judged: reach through tests alone is dead by design. `revisionAt` and `saveRevision` expose the same database as a keyed JSON memo to other inspections of `checks/law`.
