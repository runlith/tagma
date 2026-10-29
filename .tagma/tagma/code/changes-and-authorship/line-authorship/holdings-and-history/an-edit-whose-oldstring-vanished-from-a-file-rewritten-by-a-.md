---
id: 01a113c8-ea6e-7572-9852-ec67533e62c2
title: An edit whose oldString vanished from a file rewritten by a commit names that commit
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/rewrites.ts
  - kind: file
    ref: packages/agent-tools/src/edit.ts
  - kind: file
    ref: packages/agent-tools/src/WorkspaceChanges.ts
---
An edit whose oldString vanished from a file rewritten by a commit names that commit.

A commit's steps and hooks rewrite working files after publication (`ChangeRecord.reshape`), while the model edits against text it read before the commit. The `Rewrites` registry remembers, per checkout and path, the hash of the text the commit recorded and the commit itself (or `null` when there is no commit: a change emptied by the steps, or a hooks refusal). The edit door compares the read `source` against that hash only once `oldString` is no longer found, and then adds to the refusal: the file was rewritten by a commit (steps or hooks) — re-read it. Matching by hash rather than path, so a later ordinary edit of the file clears the hint.

The registry is bounded by file count and lives in server memory: after a restart there is no hint, and the edit refuses with a plain "not found".
