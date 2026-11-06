---
id: 01a14c13-c481-7acc-8aa6-03b854ec4a27
title: The agent commits whole files in a shared checkout, crediting every writer and task
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b329e7e083
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b9332b5b81
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ba0a234a8f
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03bbcfdb998e
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c6a28ec4cb
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/closure.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/team.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/message.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/submit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/operations/submit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/voice.ts
  - kind: symbol
    ref: apps/tagma/server/src/landing/contract/wire/operations.ts
    symbol: LANDING_OPERATIONS
---
**Value.** Several agents write into one tree, and any of them lands its finished work in one call, with no wait on, consent of or message to another writer: the commit is whole files as they stand on disk, every writer's lines in them credited.

**How.** The `submit_work` tool and operation (shell capability, only in a shared checkout with history). Review mode asks the operator to confirm it like any write.

**Behaviour.**
- A bare call selects the files the change record says the caller and its descendants that are no longer running wrote — held rows and retained command observations — that still differ from HEAD. `paths` replaces that with every changed file under the named files or directories, whoever wrote it; where `agent.checkout` is `single`, a bare call selects every changed file. A caller the record does not see (another harness, a session outside Tagma) names `paths`, otherwise `no-record`. A session with lines in several checkouts commits into each with a separate call.
- Beside the selection the commit carries the other path of a move; every uncommitted file of each writer whose held rows stand in a selected file (a writer whose lines were overwritten is still named, because the walk reads held rows, not a fresh line judgement); and the changed files the language adapter says a carried file needs, today the JS/TS/Svelte binder, repeated until nothing joins. A file that joined only because a carried file needs it brings from its writers just their changed files that import it, never the rest of their changes. A command observation selects a file for the caller's team but does not make the observed thread a writer. Git-ignored files, nested repositories and the graph store stay out.
- Commit steps, repository hooks and the rules court judge the tree that lands. A new crossing of a gated rule anywhere in it refuses `rule-violated` in any mode, naming the place and the other writers of that line as information; no refusal names a holder to wait for.
- An open merge with a resolved index concludes with the first landing that carries one of its paths; a landing carrying none lands beside it as an ordinary commit. A bare call with nothing selected answers `nothing` even while such a merge stands open.
- When a landing leaves working changes out, `derive` entries of the caller and of `tagma.config.ts` regenerate their declared outputs in the commit tree; undeclared derived content lands as it stands.
- `tasks` names the tasks whose work the commit carries, whoever holds them: one `Task: <name> <title>` trailer each, none ended. Without a subject, the one declared task's title is used. Omitted, the answer lists the session's held tasks as unattributed; `tasks: []` switches that off.
- The commit — like each merge or squash commit `merge_worktree` assembles — carries `Co-authored-by: Tagma <agent@tagma.dev>` unless `commits.coAuthor` is off. The branch moves by compare-and-set only; on a moved HEAD the ready tree is rebased and judged again.
- The answer names the commit; `carried`, the committed files holding other writers' lines, with those writers; `unattributed`, committed files whose working bytes the recorded row chain from HEAD does not explain (edits outside Tagma, a command of unproven writer); `left`, files of the team still differing from HEAD, each with reason `paths` (left out) or `written` (written again after the landing read it); and, when other commits already carried the team's rows, `nothing` with those commits. If the commit changes an enforced-inspection description, `rechecked` names its findings outside debt across the rule's whole reach.
- Stopping the call after publication keeps the commit in read-back by caller and call key; index updates, hooks, line accounting, after-checks and task reading left unfinished are named in `unrecorded`, and missing publication confirmation leaves the outcome unknown.

**Limits.** A running cherry-pick, revert, rebase or am must finish first. A language without an adapter adds no needed files, and the project's checks judge. When another writer's lines in a file you need fail the checks, your lines in it wait and land with theirs. A commit without steps is only on the operator's word.
