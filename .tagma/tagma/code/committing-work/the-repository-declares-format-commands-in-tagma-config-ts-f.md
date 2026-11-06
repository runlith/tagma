---
id: 01a14c13-c481-7acc-8aa6-03b9332b5b81
title: The repository declares format commands in tagma.config.ts — formatters and fixes — and Tagma runs them over every commit version of its own
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ba0a234a8f
sources:
  - kind: dir
    ref: apps/tagma/server/src/commit-steps
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CommitFlow.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/reshape.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/rewrites.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/format.ts
---
**Value.** Agents' and the operator's commits arrive in the form CI checks, and the formatter doesn't rewrite neighbours' unfinished edits on disk.

**How.** The `format` section in `tagma.config.ts` in the repository root tracked by git; the "Format" section in project settings lists the HEAD config commands (`read_config`); the `format` skill by which the agent, at the owner's request, examines what's already in the repository and proposes commands with a one-time baseline commit; "Commit without formatting" in the Git tab after a command refusal.

**Behaviour.**
- A command is argv and file masks: the commit's changed files under the masks are appended to it, as with lint-staged. Commands run in written order, each over the previous one's result, in the commit's private tree, not the checkout.
- An exit code from `ok` means "the tool ran": `eslint --fix` with `ok: [0, 1]` doesn't drop the commit over findings it left — those are judged by inspection.
- Only the step's changes to its assigned files enter the commit; writes to other files remain in the private tree and are discarded. A step that deleted a file refuses the whole commit.
- A missing program, an exit outside `ok`, signal death, a time-ceiling break, or a config that doesn't evaluate (`config-invalid`) refuses the commit: nothing is published, working files don't change. The refusal names the setup worktree state if dependencies are still installing.
- After publication, the steps' delta is applied to working files by three-way merge; a file it didn't land in stays as it was and is named. An agent's edit over such a file's stale text names the commit that rewrote it.
- Applies to `submit_work` and `commit_checkout`; a merge commit isn't formed by steps. The config is read from the commit's own version and changes with the branch.

**Limits.** A command doesn't get deleted and binary files, symlinks, files under a filter attribute, files the repository marks `linguist-generated` (a plugin's committed build output), or the graph store. An uncommitted or git-ignored `tagma.config.ts` doesn't apply. Skipping steps is only on the operator's word, for one commit. Windows is unverified: steps run through `/bin/sh`.
