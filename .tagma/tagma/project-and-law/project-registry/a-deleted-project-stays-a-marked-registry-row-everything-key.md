---
id: 01a15ad7-8f83-74b4-8f41-fa635e5f57fd
title: "A deleted project stays a marked registry row: everything keyed on its id would have been erased by cascade, while its name is free"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/projects/registration.ts
  - kind: file
    ref: apps/tagma/server/src/projects/resolution.ts
  - kind: file
    ref: apps/tagma/server/src/projects/store/table.ts
---
Deleting sets `removed_at` instead of erasing the `project` row: everything the machine knows about a project is keyed on its id — threads and journals in `threads/<id>/`, settings, notes, policy, enforcement, the change record, commands, listenings — and most of these tables hold a foreign key on `project.id` with `on delete cascade`. An erased row would carry them away in cascade, and moving data to a new id on return would take work from every owner. The mark leaves everyone untouched, and delete-with-return is one write in one row.

Registry reads (`list`, `byId`, `named`, `resolve`, graph policy) do not skip the mark: for callers a deleted project does not exist, and nobody outside the registry repeats that condition. Only registration sees the mark — a repository key or root of a deleted row returns it with its former id instead of birthing a new one — and `Projects.removed`, from which `Reach` "all" excludes deleted projects and `WorkPlaces.held` the threads' places in them. `held` is asked on every model step, so `removed` answers with a set the registry holds for its own version: every mark change — delete, return — publishes `changed` and advances the version, and a set read while the version shifted is not memoized.

A deleted project's name is free: graph storage and mirrors lie by id, so a new project under that name births its own graph. Name uniqueness is among live projects, held by the registration check in the same write transaction, not by a table constraint: every mirror's registry copy carries deleted rows too, and rows of two projects under one name. A deleted project whose name another took returns under the name `add_project` asks for; when its name is free it returns under it. Only `Projects.forget` erases a row — rolling back a registration whose graph birth never happened, when nothing has accumulated yet.
