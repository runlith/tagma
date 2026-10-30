---
id: 01a18d49-eba5-7e14-8517-20f9249b762f
title: "Projects join a group: one tile, one agent list and one start for agents across several repositories, each project keeping its own git, graph and law"
ord: 52
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a18d49-8332-708f-85d5-3198619987f6
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/prime.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Dock.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/ProjectList.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Row.svelte
  - kind: file
    ref: apps/tagma/server/src/thread-record/folders.ts
---
## Why

One system often lives in several repositories: a public product and its private cloud, a frontend and a backend, a library and the app that consumes it. In Tagma each is a project of its own, and nothing says they belong together:
- a thread's start (`prime.ts`) draws only its home project's map and the shared graph; another project is never named;
- the prompt law of another project reaches a thread only once an act already addresses that project;
- a checkout of one project nested inside another's (a git submodule) answers reads and `read_owners` with the outer project's owners and law;
- a thread doing the work of one project is listed in another's sidebar, invisible from the project it changes.

So an agent starts every task blind to the other half of the system, and the person sees the work split across two lists. A thread can already read, edit and commit in any registered project; what is missing is the knowledge, the law and one view of the work.

## What a group is

A group is a named, ordered set of registered projects Tagma treats as one system.
- Every member keeps its own repository, graph and storage, law, settings, worktrees and threads; a thread's home stays a project.
- A project belongs to at most one group. A project in no group behaves exactly as today.
- The group is registered like the shared graph: a graph of its own in Tagma's data directory, with no repository. Its root says what the system is, each member's role and how they connect; its rules bind every member, as the shared graph's rules bind every project. Law reads global, then group, then project.
- No member's committed graph names the group or the other members: a public repository's `.tagma` never mentions a private member.

## What an agent receives

- **Start.** Every member's thread opens with the shared-graph line, then the group's root, then its home project's section marked as where it stands, then each other member's section with its map. All members share the project's map budget: the home member draws its map as today, the others their top regions.
- **Prompt law.** Global, group, then every member's prompt rules, each under its project's name.
- **Code law and owners by path.** A path inside a member's checkout resolves to that member — its owners, code rules and explanations — also when that checkout is nested inside another member's (a submodule).

## The window

- **Dock.** A group is one tile: the group name's initials, a corner mark of each member's hue, the badge and crest counting work in every member. Members have no tiles of their own.
- **Header.** The crumb names the member the window stands in, as it names the project today. The project menu lists the group's members first, under the group's name; choosing a member moves the crumb and with it Files, Git, terminals and the worktree switcher. The dock tile and the agent list stay.
- **Agent column.** One list for the group: the threads of every member, one Pinned band, the group's folders, the bands as today. A thread whose home is not the group's first member carries its project's name after the title — the mark a thread from another home already carries. The marks follow the group's order, not where the window stands, so they do not move when the person opens a thread of another member.
- **Opening another member's thread** keeps the group tile, the list, its folders and scroll; only the crumb, and with it Files, Git and terminals, moves to that member.
- **Folders belong to the group.** Joining puts both projects' folders into one list unchanged. Folders with the same name stay two folders: a folder is its id, and names are not unique even within one project today. Leaving hands each project its own threads; a folder holding threads of both stays with both, each keeping its own threads.
- **Making and leaving.** "Group with" in a project tile's menu and in the project menu lists existing groups, then projects; choosing a project makes a group of the two and asks its name in one field. A member's project menu carries "Leave group"; a group of two dissolves when one member leaves.
- **New threads.** The context strip under the composer (the related spec) carries a project picker before the place; the default is the first member's main checkout.

## Decided, and why

- **One project over two repositories was rejected.** Team storage keeps a project's graph inside its repository, so a public repository would carry private modules; commits, worktrees and line records are per checkout.
- **Two tiles side by side (members kept as separate places in the dock and sidebar) was rejected.** The work on one system would stay split across two lists, and a thread started in one member would stay invisible from the other.
- **Marks by group order, not by where the window stands.** Marks relative to the current member would flip on every row each time the person opens a thread of the other member.
- **Folders are never merged by name.** The same name may mean different things in two projects, and a merge could not be undone.

## Acceptance criteria

- A thread of a member starts with the group's root, a map of every member and every member's prompt rules, each labelled with its project.
- Reading or writing a file under a member's checkout nested inside another member's delivers the nested member's code rules, and `read_owners` on that path answers the nested member's owners.
- The dock shows one tile for the group; the agent column lists the threads of every member; opening a thread of another member keeps the tile, the list and its folders.
- Joining and then leaving returns each project its threads and folders as described.
- A project in no group shows no change at any door.
- Typecheck and the affected packages' tests pass; minimal contract tests through the orientation, owners and folder doors.
