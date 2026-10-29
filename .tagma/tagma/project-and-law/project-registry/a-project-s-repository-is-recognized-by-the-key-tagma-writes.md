---
id: 01a16957-3767-7d91-b01e-461b7fcadac2
title: A project's repository is recognized by the key Tagma writes into its git directory, not by the root commit
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14566-7ba5-7830-95e4-9f342e770fe6
sources:
  - kind: symbol
    ref: apps/tagma/server/src/projects/identity.ts
    symbol: heldKey
  - kind: symbol
    ref: apps/tagma/server/src/projects/identity.ts
    symbol: keyHolds
  - kind: symbol
    ref: apps/tagma/server/src/projects/registration.ts
    symbol: markedRoots
  - kind: symbol
    ref: apps/tagma/server/src/projects/registration.ts
    symbol: placeOf
---
A project is a folder the user added. A repository is recognized by the key Tagma writes into the shared git directory at registration (`<git-common-dir>/tagma/project`: the key and the git directory's own path): worktrees share that directory and stay checkouts of one project, a folder move carries the key along, a fresh clone does not receive it, `git fetch --deepen` does not touch it. So a second clone, a fork and a project from the same template are separate projects with their own graph, threads and settings, not a `duplicate-root` refusal.

A copy (`cp -r` with `.git`) carries another's key, and it must not be silently accepted as the same project. It is told apart on two levels. Identification (`heldKey`) reads a key as its own only when the recorded git-directory path matches its own or nothing answers at the recorded path anymore; otherwise the folder has no key. But another's folder can also carry the key recorded for that same folder: a restored copy at the former place after a move, an old repository after `set_project_root` elsewhere. So whether the key matches a project is judged by one registry function (`keyHolds`) for registration, resolving a project by `cwd`, and graph checkout choice: when the project root itself holds that key for another git directory, the folder does not belong to the project. When a registered root lacks that key, that is a move: adding the folder at the new place returns the project with its former id and moves its root, like `set_project_root`. A copy whose source was deleted before it was added is indistinguishable from a move and stays the same project — a decided boundary: a git-directory inode in the mark would tell it apart, but then a move across disks and a backup restore would lose the project.

A folder without git holds no key: its identity is the physical path, moves are not tracked, and relocation is `set_project_root`. Writing the mark into the working folder itself is rejected: Tagma puts no files into the user's folder outside the git directory.

A git folder without its own key (registered before this scheme, key erased, a clone in place of the former) is recognized by root: that is how a deleted project returns from the same folder and how `cwd` finds a project. Registry opening (`markedRoots`) writes the key once into every standing project's git directory that lacks one: the former key (root commit) stays as is, a key path of a repository registered before the first commit is replaced with a new one — the project id does not change. A new key is first recorded in the registry, then in the git directory: a start interrupted between them completes the mark on the next opening instead of leaving it ahead of the row. The mark is replaced by renaming a finished file, so a write failure does not erase the former key. Deleted projects receive no key: Tagma has left their checkout.

Rejected: the root commit (`rev-list --max-parents=0`) — shared by clones, forks and template projects, and shifting in a shallow clone after deepening; checking copies only in the registry — then `cwd` in an unregistered copy would serve the source project.

Two clones of a team repository carry the same committed graph files and hence one root uuid: an edge from another project into such a graph reads `ambiguous`.
