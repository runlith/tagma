---
id: 01a15ab7-7245-7507-9663-d2743bb6f089
title: Removing a project from Tagma is a registry-row mark, returning by repository key
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/removal.ts
  - kind: file
    ref: apps/tagma/server/src/projects/registration.ts
---
## What the user gets

The project menu (the tile context menu in the dock and tabs, and the project menu in the top line when there is no dock) carries "Remove from Tagma…". The confirmation says one thing: the project leaves the list, nothing is deleted from disk — repository, graph and threads stay in place; the same directory, added again, brings the project back with its graph and threads. When agents work in the project, the dialog names their count: removal stops them. No preconditions: neither "delete blocks first" nor "delete threads first".

Re-adding is the regular New project or folder picking on desktop. When the folder's repository was this machine's project, it returns: the same id, the same name, the same policy and storage, the same graph, threads, settings and notes; the name, storage and directories entered in the dialog do not apply to a returned project. The window opens the returned project and toasts that it is back with its graph and threads.

## Model: the registry row stays with a mark

`project` gains `removed_at`. Removal sets the mark, return clears it. The row must not be deleted, nor data switched to a new id on return: everything the machine knows about the project is keyed by its id — threads and their journals `threads/<id>/`, settings, notes, policy, enforcement, change record, commands, listenings — and most tables hold a foreign key to `project.id` with `on delete cascade`. Deleting the row would cascade-wipe them, and switching journals and tables to a new id is per-owner work. The mark touches none of them: removal and return are one write in one row.

The repository key recognizes the project on return (`repo_key`, the root commit or the directory path without commits) — the same one holding the "one project per repository" rule. The root may change (another clone of the same repository): the return writes a new `root_path`, like `set_project_root`.

A removed project's name stays taken: stealth and plain graph stores (`<appHome>/<name>`, `<plainHome>/<name>`) and mirrors lie by name, and a new project under the same name would open someone else's graph. Registering under such a name refuses `duplicate-name`, saying the name is held by a project removed from Tagma, with the way out: add its folder again or pick a different name.

## Registry (`projects`)

- `Projects` reads — `list`, `byId`, `named`, `resolve`, `global` — never see removed projects: to every caller a removed project does not exist, as after row deletion before. So with no per-place fixes, doors do not find it by name, id or cwd, `ServingSwitch` does not open its graph, and other projects' edges into its graph read `absent` (`not on this machine`).
- `Reach` "all" ("every project on this machine") carries removed projects' ids, and conversation and call search skips their threads and listenings; threads without a project stay in the results.
- `register` looks at the repository key first: a marked row returns (mark cleared, root written) and answers `returned: true`; otherwise the previous name and root checks and a new row insert. Name checks do not apply to a return.
- `remove` sets the mark; the global project refuses `global-permanent`. `forget` deletes the row — only rolling back a registration whose graph birth never happened (`takeBack`).
- `RemovalHold`, its holders in graph (`pool`, `birth`), threads (`lifetime`), workspace (`coverage`), the `admit` check in composition and the `project-not-empty` refusal go away: there is nothing to hold.
- The registry dump (`registry.json`) carries `removedAt`; machine restore from it preserves it. The registry copy in mirrors (`syncRegistry`) carries the column as is.

## Graph (`graph`)

- `ProjectLifecycle.remove` no longer cleans the graph and the project's rows: it sets the mark, publishes `removed` after commit, and writes `project_remove`. The on-disk graph is untouched in any storage.
- On `returned`, `ProjectLifecycle.create` births no graph and writes no policy, root, directories or `rows-step`; it writes `project_return`; `add_project` then does not call `pool.birth` — the graph opens on first access, as after a restart — sets the commit gate in the checkout (`RegisteredRoots.joined`), and answers `returned`.
- Policy reads (`ProjectPolicy.read`, `byId`) never see removed projects; `ensureVocabulary` does not touch their rows.

## What removal releases

`ProjectChanges.removed` subscribers release only the live, data stays:
- the graph pool closes the project's copies, the project's MCP servers stop, the execution host learns the held command output's owners are gone — as now;
- threads stop the runs and harness sessions of the project's threads, take down their commands and calls, and free transport resources — the same order as archive, with no archive mark; one stop's failure is logged and cancels none of the rest;
- speech stops the project's live listenings and re-recognition, but erases no sound files and cleans no search index;
- in-memory caches of notes and pinned views are no longer dropped: their rows stay, and a returned project sees them at once.

Thread background commands with no running turn are not dropped by removal: they finish on their own.

## App

- `StripMenu` (project context menu in the dock and tabs) and the top-line project menu gain a `Remove from Tagma…` item (variant destructive) for every project except global.
- One dialog per window (`ProjectRemoval` plus a dialog component next to `NewProjectDialog`): title "Remove "name" from Tagma?", a description that nothing is deleted from disk and how to bring it back, a working-agents line from `ProjectPulse`; Cancel and Remove buttons. A refusal shows in the dialog.
- After removal: the project list is re-read, the project is off the strip, and when it was open the window goes to `/`, which leads to the next project.
- On a `returned` answer, `ProjectCreation.create` toasts about the returned project and opens it.

## Verification

- system test through doors (`projectsDoor.stest.ts`): a project with a block and a thread is removed; the list omits it, the name does not resolve, the graph files and the thread journal are on disk; adding the same root under a different name answers `returned` with the same id and name; block and thread in place.
- `projects.itest.ts`: removal is atomic and publishes changes (no `project-not-empty`); tests that deleted a project to re-register with different storage move to switching storage or to their own directory.
- typecheck; UI on `tagma:try`: menu item, dialog, deleting the open project, return via New project.
