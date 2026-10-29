---
id: 01a10c7f-b81b-74a4-9238-ce861a12cdbd
title: A violation standing only on one path missing from the judged tree belongs to whoever holds that path uncommitted in the working tree
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
The landing court sees HEAD plus the session's lines. A session import can point at a file that already stands in the working tree but isn't yet committed by a live teammate. The judged tree has no such file, and `modules` or `platforms` see unresolved. The import line belongs to the session, so attributing by lines alone would block a commit over someone else's unfinished lines — and the `submit_work` contract forbids that.

**Inspection.** Names in `absent` the paths that each remove the violation by appearing alone: the import resolves to that path, and the import site gains no new violation.
- Code-facts (`fileEdges`) keeps only the resolver probes the import would resolve to if that one probe appeared. A directory `package.json` probe doesn't get in.
- `modules` judges an edge to each candidate with the same owner, door, relation and order logic as real edges, and keeps only lawful candidates.
- For two paths appearing at once the contract promises nothing: in `platforms` `resolveUnique` answers "more than one", and in `modules` the first probe in order wins.

**Change record.** `holds` of the prepared change answers for each such path with one of four values:
- `missing` — the working tree has no file with that path for the landing to carry. Happens when the path is written in a different case, lies in a nested repository or in `.git`, matches `.gitignore` or the graph storage.
- `unheld` — the file stands, but no live typed record holds it: it was written by a shell, an ended session or someone outside Tagma.
- `own` — the session itself or one from `taking` holds the path.
- `peers` — only live teammates hold the path.

A working-tree read failure other than a missing path becomes an inspection refusal, not a "no path" answer.

**Court.** `attributed` assigns the violation as follows:
- the holder of the violation's line decides first;
- otherwise the violation is assigned to a path only if exactly one path from its `absent` stands in the working tree;
- for `own` the violation stays with the session: the refusal names the path in `withheld`, and the first `unblock` suggests adding it to `paths`;
- for `peers` the violation goes to `carriedViolations` with those holders and the path in `withheld`. After landing, remeasure records an escape on the holder and tells them the import stands only on their path and that landing that path removes the violation.

The previous refusal stands in all other cases:
- the path is `missing` or `unheld`;
- more than one path from `absent` stands in the working tree;
- no `holds` at all (`git_commit`, staged).

`absent` doesn't go out on the wire: `wireOf` strips it from every violation projection, and only `withheld` is visible outside. `check_rules` over change goes through the same `attributed` and the same prepared subject, so it answers exactly as the landing does.

Boundary: a path appearing later doesn't force a re-read of its importers. If the module map changes between landings or another added file shadows the candidate, no gate judges the edge until the rule is fully remeasured ([[4799e983|task]]).
