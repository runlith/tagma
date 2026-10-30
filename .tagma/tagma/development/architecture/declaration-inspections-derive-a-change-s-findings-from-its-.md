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

Only a whole reading (`check_rules` over "all", a remeasure) builds the index: it lists the tree and parses every blob it lacks. A judgment of a change never scans and never computes a whole result: it derives the revision's index from the nearest of the last indexed ones by `git diff-tree`, and its findings from the nearest cached result of the same parameters (the base's, or the newest of the last 6 within 5000 changed files), and when none exists it fails with the setup action (`check_rules` over "all") instead. The whole reading caches its findings by revision; the judgment of a change re-judges only the owners the change can move — the changed files and the exporters whose consumption edges (import, re-export, load) it added or removed — and answers the complete set with `covered: 'reach'`, so it agrees with the remeasure exactly.

A `package.json` edit moves something only when the package's name, exports or entries change: the files importing that package by name are re-resolved before and after, and its entry or published targets are re-judged. A pattern load (`import.meta.glob`, a template `import()`) is resolved against the listing of its static directory only. A load whose static directory is the repository root, and a change of the root package's name, exports or entries, cannot be judged on a commit and fail asking for the remeasure.

An export is dead when no production file imports it; an exported function also needs a runtime caller, so type-only imports and `typeof` positions do not count. Reach is direct: an importer that is itself unused still consumes. Test files, `testing` folders and declaration files are matched by the `tests` globs and are neither consumers nor judged. A referenced type counts by the declaration it names — the module an import resolves to, or the declaring file for a local one — not by its spelling, so equal members that point at different `Row` types are no repeat and aliases of one imported type are. The module an import resolves to goes through the same resolver as dead-code — relative, alias and workspace package exports — so a package public path and a relative path to one file name one declaration. A barrel that re-exports the declaration, and a local `type R = Row` alias, still name another module and miss the repeat; they never invent one.

Fingerprints name the export or shape and the file, never a line, so an edit above a declaration keeps its debt; each file of a repeated group carries its own finding. `revisionAt` and `saveRevision` expose the same database as a keyed JSON memo to other inspections of `checks/law`.
