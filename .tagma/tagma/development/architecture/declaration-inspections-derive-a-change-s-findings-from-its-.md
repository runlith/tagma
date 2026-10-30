---
id: 01a18d61-e9fc-70f8-b28a-6336903c6f97
title: Declaration inspections derive a change's findings from its base's cached findings over a blob-keyed index; only a whole reading builds the index
ord: 28
tags: ["explanation"]
sources:
  - kind: dir
    ref: checks/law/declarations
---
The facts of a source file — its exports, imports, uses by value or type position, and type shapes — are a function of its git blob alone, so `database.ts` keeps them per blob in `<git-common-dir>/runlith-law/declarations.sqlite`, with the places a blob stands at, the import links and shape keys that find importers and copies, and the findings of each judged revision. The index resets whenever a file that defines it changes.

Only a whole reading (`check_rules` over "all", a remeasure) builds the index: it lists the tree and parses every blob it lacks. A judgment of a change never scans: it derives the revision from the nearest of the last indexed ones by `git diff-tree`, and when none lies within 5000 changed files it fails with the setup action instead of scanning. The whole reading caches its findings by revision; the judgment of a change derives the new revision's findings from its base's cached ones by re-judging only the owners the change can move — the changed files and the exporters whose consumption edges (import, re-export, load) it added or removed — and answers the complete set with `covered: 'reach'`, so it agrees with the remeasure exactly. A change to a `package.json`, or to a file that loads by pattern, falls back to a whole reading of that revision.

An export is dead when no production file imports it; an exported function also needs a runtime caller, so type-only imports and `typeof` positions do not count. Reach is direct: an importer that is itself unused still consumes. Test files, `testing` folders and declaration files are matched by the `tests` globs and are neither consumers nor judged. A referenced type counts by the declaration it names — the module an import resolves to, or the declaring file for a local one — not by its spelling, so equal members that point at different `Row` types are no repeat and aliases of one imported type are.

Fingerprints name the export or shape and the file, never a line, so an edit above a declaration keeps its debt; each file of a repeated group carries its own finding. `revisionAt` and `saveRevision` expose the same database as a keyed JSON memo to other inspections of `checks/law`.
