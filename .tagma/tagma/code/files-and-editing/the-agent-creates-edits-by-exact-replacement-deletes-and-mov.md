---
id: 01a14c13-c481-7acc-8aa6-03b1b9862e1b
title: The agent creates, edits by exact replacement, deletes, and moves files, and a write doesn't overwrite another's edit
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b0bcebf852
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b329e7e083
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b9332b5b81
sources:
  - kind: dir
    ref: packages/agent-tools/src/removal
  - kind: file
    ref: packages/agent-tools/src/changed.ts
  - kind: file
    ref: packages/agent-tools/src/delete.ts
  - kind: file
    ref: packages/agent-tools/src/descriptions.ts
  - kind: file
    ref: packages/agent-tools/src/edit.ts
  - kind: file
    ref: packages/agent-tools/src/rename.ts
  - kind: file
    ref: packages/agent-tools/src/write.ts
---
**Value.** The agent changes code so its lines stay its lines, and an edit that missed another's write doesn't silently overwrite it.

**How.** The native agent's `write`, `edit`, `delete`, `rename` tools (the files capability).

**Behaviour.**
- `edit` replaces a piece of text — one occurrence or all; an empty `oldString` creates a file. Several exact occurrences without `replaceAll` refuse before fuzzy-match attempts, even if line indents differ. The file's line endings are preserved.
- `write` writes content whole or copies another file's bytes (`fromFile`); a refused write's content is kept, and the retry takes it via `fromFile`.
- Writes go through a per-path queue and compare-and-set: if the file changed between read and write, nothing is written, and the agent gets "read again". A missed file edit, meanwhile overwritten by commit steps or hooks, names that commit.
- `delete` removes file lists, pattern matches, empty directories, and trees in one call with the familiar arguments of non-interactive rm. Preparation costs as much as the operands: it finds their roots — named paths and pattern matches — and doesn't walk trees, and the confirmation names those paths. A tree under `-r` is walked at execution directory by directory, without an in-memory snapshot: removed is what lies in it at walk time. A root replaced after preparation, a directory replaced during the walk along with everything in it, and a write changed between its read and deletion stay; links are deleted without walking the target. An operand inside another tree is deleted by its walk, and under `--one-file-system` an operand on another device stays a separate root.
- Deletion returns counters for all writes, a line per root with the count deleted in its tree, and lines only for the failed, skipped, or unconfirmed; `-v` adds a line per write, a big report goes to a file. The short answer doesn't depend on the files' authorship accounting. One target's refusal doesn't cancel independent completed deletions. Force suppresses absence, not OS or accounting errors. On cancellation what is done stays, and the unfinished root and following ones answer "unprocessed" with the count already deleted.
- Every write in a registered project's checkout becomes the session's line in authorship accounting; a move is recorded as a move, not a deletion plus a new file.
- In review mode every write asks the operator.
- Where the project forbids comments, prose-added comments are stripped on write (the policy — A4).

**Limits.** `rename` takes one text file, doesn't move symlinks or binary files, and doesn't replace an existing one. `delete` doesn't run a shell or rm's interactive options; confirmations are set by Tagma mode. The tools reach any machine path: an act in another project's checkout enters that place and is written to its accounting — tree deletion enters every checkout standing inside it too; a file outside all checkouts is written without line accounting and deleted without reading contents. Deletion doesn't index files or create a Git commit.

Divergences from tool descriptions: `edit`'s description requires an exact match, while on a miss the code tries matching insensitive to whitespace, indents, escaping, and surrounding spaces; `rename`'s description says both paths stay inside the workspace, while the native agent works without that fence; the path descriptions of `write` and `edit` require an absolute path, while a relative one resolves from the thread root.
