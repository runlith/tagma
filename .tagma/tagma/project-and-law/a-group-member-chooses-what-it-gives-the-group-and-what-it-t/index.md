---
id: 01a1a345-6106-7f32-b985-6fd24982992c
title: "A group member chooses what it gives the group and what it takes from it: map, law and skills"
ord: 53
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a18d49-eba5-7e14-8517-20f9249b762f
  - kind: relates
    to: 01a18d86-3376-7adb-aa00-abfaf88b843f
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/Instructions.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/prime.ts
  - kind: file
    ref: apps/tagma/server/src/projects/groups.ts
---
## Why

A group shares every member's start map, prompt law and project skills with every other member. That fits members that are one system of code — a public product and its private build — and is wrong for a member of another nature standing beside them: a project of marketing research, documentation or planning with no code. Today such a project, once grouped, puts its rules and skills into the start of every agent writing the members' code and spends their map budget on its regions. Kept outside the group it loses the one tile, the one agent list and the start that tells its agents what the other members are.

What such a project needs is control of each direction: it takes from the members what serves it and gives them nothing — or any other mix.

## What changes

A member of a group carries what it **gives** the group and what it **takes** from it, each a choice among three things the group shares:

- **map** — its root and top regions in another member's start;
- **law** — its prompt rules in another member's prompt law;
- **skills** — its project skills in another member's skill catalog.

One member's thing reaches another member's thread exactly when the first gives it and the second takes it. A new member gives and takes everything, which is what every member does today.

- A thread's start draws only the members whose map reaches it, sharing the map budget among them; the group root line names the home member and those members.
- A thread's prompt law is global, then the group graph's rules, then the home member's own rules and the rules of each member whose law reaches it, in the group's order. The group graph's rules reach every member whatever it takes: they are the law of the whole system, not of one member.
- A thread's skill catalog composes the skills of each member whose skills reach it.
- Law still arrives where an agent acts: an act in another member's place delivers that place's instruction set as today.
- Code rules and owners by path, the dock tile, the agent list and folders, making, joining, leaving and dissolving do not change.
- A change of what a member gives or takes moves the registry revision like any membership change, so running threads of every member read the start, law and skills that now stand at their next turn, the law as an instruction change.

## Doors

- `set_group_sharing { project, gives?, takes? }` sets what a member gives and takes; a list left out stays as it is; a project in no group refuses `ungrouped`.
- `list_groups` and `read_group` answer what each member gives and takes.
- In the window, a member's project menu carries a "Sharing" submenu next to "Leave group": what it gives the group and what it takes from it, each thing a check item.

## Owners touched

- Membership storage in the machine store (`group_member`) keeps what a member withholds and declines, empty for every existing row.
- `ProjectGroups` answers each member's sharing with the group and the projection naming whose map, law or skills reach a member; `Orientation.instructions`, `Orientation.render` and the workspace skill catalog read that projection.
- `GroupLifecycle` journals a sharing change as a registry act.
- The group operations' wire and the app's `ProjectsRepo`, grouping service and project menu.
- The group feature and the explanations of group law, start and skills are corrected in the same change.

## Decided, and why

- **Each direction and each thing on its own.** The operator wants every kind of sharing controllable; one role (an "observer" giving nothing and taking only maps) was rejected as a fixed mix of what is really six independent choices.
- **Stored as what a member withholds and declines.** A thing the group starts to share later — agents, MCP servers — then reaches every existing member by default, as it would a new one; stored as what it gives, every existing member would silently withhold it.
- **Kept in the registry, not in settings.** Whose things reach a member is one fact of the group, answered by its owner `ProjectGroups` beside membership; settings sit above the registry, so the registry could not answer it from them, and each consumer would derive it again.
- **Group graph law reaches every member.** It binds the system as a whole, such as what may become public; a member wanting none of it does not belong in the group.

## Acceptance criteria

- With defaults, every door answers as before: start, law and skill catalog of every member unchanged.
- A member giving nothing: no other member's thread start, prompt law or skill catalog carries anything of it, and the group root line of their starts does not name it; its own threads still receive every other member's map, law and skills.
- A member taking only the map: its start draws every giving member's map; its prompt law is global, group and its own rules; its catalog holds only its own skills.
- `set_group_sharing` changes what a member gives and takes; `list_groups` and `read_group` answer it; a project in no group refuses `ungrouped`.
- A sharing change reaches a running thread of another member as an instruction change at its next turn.
- Typecheck and the affected packages' tests pass; minimal contract tests through the orientation, skill catalog and group operation doors.
