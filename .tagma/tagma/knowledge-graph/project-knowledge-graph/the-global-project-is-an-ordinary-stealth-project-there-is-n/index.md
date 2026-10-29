---
id: 01a15e61-d6ef-7bf3-b089-23b203c2c6d6
title: The global project is an ordinary stealth project; there is no plain mode
ord: 90
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14094-c3c2-7725-8771-345a1510a61b
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6324da5f3f35
---
**Why.** The global project is the first thing a user has after install. It must work like any project: agents, files, tasks, branches, and worktrees if its folder has git. It has one difference: its rules apply in every project. Plain mode is now needed only by it yet gives no branches; on projects it duplicates stealth worse and breeds defects like [[1510a61b]]. The user picks between two modes: team (graph in the repository) or stealth (graph in Tagma's data).

**What will stand.**
- Two storage modes: `team` and `stealth`. `plain` is removed from the projects owner's `STORAGE_MODES`, layouts (`graph/storage/layout.ts`), moves (`graph/storage/move.ts`), opening and pool (`graph/serving/*`), CLI `--storage`, `set_project_storage`, the New project dialog, Settings → Graph files, and test fixtures.
- Stealth also works for a folder without git: one graph tree and Tagma's own git, no twin branches. Once git appears in the folder, the graph starts following checkouts and branches like any stealth project. This closes both the global project and any folder-project without git.
- The global project is born stealth. `ensureGlobal` no longer imposes a mode; all projects' stealth stores lie in a separate `graphs/` space of the data directory, so they never occupy the matching project's working folder. Old stealth stores move there in the same graph step. The global project root stays `~/.tagma-dev/global` (or its own in the data directory).
- Other projects receive global's law from its main copy, like any foreign graph today: global's branches and worktrees never affect them before merging.
- The global project can be made a thread and child agent's home: the `global-home` refusal is removed. The `global-permanent` move ban is removed: global moves between team and stealth like any project.
- Existing plain graphs (global on every machine and any plain projects) convert to stealth on update in their owner's step, with no block or history loss; a server that opened a plain graph is never met.
- The `measureNotice` warning about one graph for all branches is removed with plain.

**Acceptance.**
- On a clean data directory the global project is born stealth; a thread homed in it writes files and blocks, and after `git init` in its folder commits and works in worktrees; its graph's rule reaches another project.
- A data directory with a plain global opens stealth after the update, with the same blocks.
- `--storage plain` and `set_project_storage` to plain refuse as an unknown mode.
- [[1510a61b]] is closed by this work: there is no plain variant.
- The working graph contract and the app's storage code hold no plain mode. Its old value is read only by the stored-shape transition step and old-registry restore; historical fixtures verify that transition.
