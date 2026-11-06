---
id: 01a17f5f-3c8d-78c2-b6c7-2ab1c11265c5
title: "The commits Tagma assembles state what changed and why: repo format, body, trailers, graph commits from Tagma <agent@tagma.app>"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/storage.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/committer.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/batch.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/commits.ts
  - kind: file
    ref: apps/tagma/server/src/landing/doctrine/commits.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/message.ts
  - kind: file
    ref: apps/tagma/server/src/landing/merge/modes.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/retirement/branch.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/retirement/cleanup.ts
---
**What we get.** For any Tagma user, a commit assembled by Tagma reads without Tagma: the subject in the repo's accepted shape, the body stating what changed and why, trailers stating which tasks it carries and that a Tagma agent took part. Graph commits are signed `Tagma <agent@tagma.app>` — the `tagma-dev` account — state what changed in knowledge, and are recognized by content, not by subject.

## What stands now

- `submit_work`: the caller gives the subject; task names are appended to the first line as `(26c5d6b8, …)` (`landing/land/message.ts`). No separate body: multi-line text can only pass inside `subject`. Author, committer, and signature are the user's, as with `git commit`. Doctrine (`landing/doctrine/commits.ts`) asks the subject to be "concise, in the repository's style".
- `merge_worktree`: `Merge worktree <name> (<branch>) into <base>` and the `Tagma-Worktree: <rootId>` trailer (`landing/merge/modes.ts`). `commit_checkout` writes the caller's message whole — that is its contract, it does not change.
- Team-graph commit: `tagma: graph @ <journal position> (<session names>)`, author and committer `tagma <tagma@tagma>` (`graph/tree/commits.ts`, `graph/tree/batch.ts`); it leaves after 10 s of record silence and at least every 2 minutes of continuous records. The stealth-graph commit is assembled by other code (`graph/serving/committer.ts`): `done 65eec4a8` per act, `N acts: …` in batch, author is the session name.
- Worktree deletion and cleanup tell graph commits from work apart by content: a commit whose every changed path lies in the graph tree is no work, whatever its subject or author, so old `tagma: graph @ N` commits and any later shape are the same case (`worktrees/retirement/branch.ts`, `cleanup.ts`).

GitHub binds a commit to an account by author email; `tagma@tagma` binds to nobody, so graph commits go with no avatar or link.

## What will be

### Repo-convention shape

Tagma imposes no shape: before a graph commit it reads the subjects of the last 10 branch commits not made by it, and if most follow Conventional Commits (`type(scope)!: …`), it writes its commit in the same shape, else as a plain capitalized phrase. So does Renovate. Words Tagma writes itself are English; block titles are the graph's language.

### Agent commits (`submit_work`, `merge_worktree`)

- `submit_work` takes a body separately from the subject. The agent writes the subject in the repo style and the body in one to three sentences: what changed in behavior and why; a micro-edit may omit the body. Doctrine states it in one line.
- Tasks move from subject into trailers: one `Task: <name> <title>` line per task the commit carries. The subject stays the caller's words. No reader parses the current suffix out of history, so moving it breaks nothing.
- Every commit Tagma assembles from agent work — `submit_work` and the `merge_worktree` merge commit — carries `Co-authored-by: Tagma <agent@tagma.app>`. A project setting, on by default, removes it. Author, committer, and signature stay the user's: it is their repo and their contribution.
- All trailers are one block at the end after a blank line, in `git interpret-trailers` shape; `Tagma-Worktree` joins the same block.

### Graph commits

- One owner assembles one message for team and stealth; the second assembler leaves.
- Author and committer are `Tagma <agent@tagma.app>`, the product constant. The address is verified on the `tagma-dev` machine GitHub account: for any user the commit on GitHub shows the Tagma avatar and leads to `github.com/tagma-dev`; on other hosts this name and address.
- Subject is the batch meaning by weight: opened and closed specs, done and new tasks, new rules, then the rest. One leading act gets its title, if it fits 72 characters, else a count by kind: `docs(graph): finish 2 tasks, open spec, edit 4 explanations`. Without Conventional Commits — the same phrase with no prefix.
- Body is one line per batch act: verb, block name, title; repeated edits of one block are one line. The last line names the agents whose acts are in the batch.
- The journal position leaves the subject for the `Tagma-Graph: <position>` trailer.
- The batch rhythm does not change: commits are neither inflated nor trimmed.

### Recognizing graph commits

A graph commit is one whose every change lies in the graph tree (`.tagma`). Worktree deletion and cleanup recognize it that way, not by subject or author; old `tagma: graph @ N` commits are recognized by the same rule with no separate code branch.

## Performer checks

Through real doors:
- `submit_work` with tasks and body gives the caller's subject, a body, and a `Task` + `Co-authored-by` trailer block; with the setting off — no `Co-authored-by`.
- `merge_worktree` gives one trailer block with `Tagma-Worktree` and `Co-authored-by`.
- Team graph in a Conventional Commits history repo commits `docs(graph): …` from `Tagma <agent@tagma.app>` with a body per act and `Tagma-Graph`; in a repo without it — a subject with no prefix.
- Deleting a worktree counts graph commits of old and new shape as no work, and counts a commit touching both code and `.tagma` as work.
- The stealth graph commits with the same assembler.

Explanations [[ed330a7f]], [[14955e6b]] and the blocks touched are fixed by the same change.
