---
id: 01a111ce-3737-7517-8b69-f747435f5333
title: Working view of files from git for all comparison bases, and no BOM stripping in edit, write and textsAt
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a111ce-9257-7904-8696-f02341caabc2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a111ab-9639-7730-81d5-593018d06fb3
sources:
  - kind: dir
    ref: packages/git
---
Implement from [[18d06fb3]] the working view of files from git and no BOM stripping — the "Working view from git" and "BOM is not stripped" items of the "One shape on every platform" section.

Included:
- one reader in `packages/git`: commit files by path in working form (eol, `working-tree-encoding`, filters, BOM, true size) — `git archive` by commit and paths in one process; paths with `export-ignore` or `export-subst` (`git check-attr`) — `git cat-file --filters <commit>:<path>` one by one. Land the reader itself first as its own commit: task [[9b7f62ff]] uses it;
- move onto it every base that is compared against working bytes or edit texts: `record/holding.ts`, `prepared/tree.ts`, `record/runFiles.ts`, `threadFiles/weigh.ts`, `record/heldCounts.ts`, `record/discharge.ts`; the raw blob stays where the repository view is needed (`landing/land/indexSync.ts`, `prepared/subject.ts`);
- BOM is not stripped in `edit`, `write` (`readFileString` strips it, `edit` writes the file back without it) and in `textsAt`.

Done when, with `core.autocrlf=true`, editing one line of a CRLF file yields a one-line hunk and rolling back the turn returns the file byte for byte; the digest of a file with BOM in the snapshot matches the digest of its edit text; typecheck and the affected tests are green.
