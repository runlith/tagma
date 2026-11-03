---
id: 01a10c7f-b81b-74a4-9238-ce861a12cdbd
title: A violation standing only on one path missing from the judged tree names that path as withheld, with its writers
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/implementation.ts
  - kind: symbol
    ref: apps/tagma/inspection/src/core/verdict.ts
    symbol: Absent
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/holds.ts
    symbol: holdsOf
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/judging/excess.ts
    symbol: attributed
  - kind: symbol
    ref: packages/code-facts/src/tree.ts
    symbol: fileEdges
---
The landing court judges the tree that lands. A carried file's import can still point at a file that stands in the working tree, uncommitted, but is not in that tree: a language without an adapter, a use the walk could not see, or a file left out through `paths`. The judged tree has no such file, and `modules` or `platforms` see an unresolved import. The crossing then names the one path whose landing would end it.

**Inspection.** Names in `absent` the paths that each remove the violation by appearing alone: the import resolves to that path, and the import site gains no new violation.
- Code-facts (`fileEdges`) keeps only the resolver probes the import would resolve to if that one probe appeared. A directory `package.json` probe doesn't get in.
- `modules` judges an edge to each candidate with the same owner, door, relation and order logic as real edges, and keeps only lawful candidates.
- For two paths appearing at once the contract promises nothing: in `platforms` `resolveUnique` answers "more than one", and in `modules` the first probe in order wins.

**Change record.** `holds` of the prepared change answers for each such path with one of two values:
- `missing` — the working tree has no landable file with that path. Happens when the path is written in a different case, lies in a nested repository or in `.git`, matches `.gitignore` or the graph storage.
- `stands` — the file stands, with the writers whose rows hold it who are not on the caller's team.

A working-tree read failure other than a missing path becomes an inspection refusal, not a "no path" answer.

**Court.** `attributed` names for each crossing the writers of its line, and, when exactly one path from its `absent` stands, adds that path's writers and sets `withheld` to the path. The crossing is a refusal like any other; `withheld` makes the refusal's first way out `submit_work` with `paths` that also names the path beside the carried files, and the finding reads "written by …, standing only on <path>, which the working tree holds and this change leaves out".

The plain refusal stands in all other cases:
- the path is `missing`;
- more than one path from `absent` stands in the working tree;
- no `holds` at all (`git_commit`, staged).

`absent` doesn't go out on the wire: `wireOf` strips it from every violation projection, and only `withheld` and `holders` are visible outside. `check_rules` over change goes through the same `attributed` and the same prepared subject, so it answers exactly as the landing does.

Boundary: a path appearing later doesn't force a re-read of its importers. If the module map changes between landings or another added file shadows the candidate, no gate judges the edge until the rule is fully remeasured ([[4799e983|task]]).
