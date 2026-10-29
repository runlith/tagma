---
id: 01a15438-bced-74e1-b379-da11308cf874
title: The `migrations` and `step-places` checks in `checks/law` reuse declaration parsing until a path it read changes
ord: 45
tags: ["explanation"]
sources:
  - kind: file
    ref: checks/law/declarations.ts
  - kind: file
    ref: checks/law/migrations.ts
---
The `migrations` and `step-places` checks judge the whole reach, but their parsing is a function of only the texts of files read: every file under `source` containing one of the words `sqliteTable|manifest|formSteps|tables`, and files resolve reached through relative imports. So the program stores in the git common dir (`runlith-law/migrations.json`) each file's contribution together with the blob ids of every path it read, plus the scanned-file list of each known snapshot. A new snapshot derives from the nearest known one via `diff-tree`: changed paths drop out, `git grep` rechecks changed candidates, and only a file that itself changed or whose read path changed is re-read. External keys' verdict is stored by migration folder contents and history-table set.

What holds the invariant: the path resolve walked is recorded in the contribution of the file that reached it. Otherwise an edit to a steps file without keywords (e.g. `steps/x.ts` with a single step object) won't be re-read, and a retroactively assigned step will pass judgement.

Memo is only speed. Its version is the hash of `migrations.ts`, `declarations.ts`, and `git.ts`, so editing the program starts from a clean memo. A missing, corrupt, or unreadable memo is judged as empty, and one not written due to a filesystem error is simply lost — the answer doesn't change. A snapshot missing from the object store or a diff of more than 512 candidates leads to a full scan, while contributions of matching files are still reused.

Only a file that can declare nothing skips TypeScript parsing: it has no backslash, no `sqliteTable`, and no `manifest` together with `formSteps` or `tables`. Without escape sequences, identifier and string-key text matches the source, so this selection is no narrower than what parsing recognizes. A file with `\` is always parsed: TypeScript reads `manife\u0073t(...)` as `manifest`.
