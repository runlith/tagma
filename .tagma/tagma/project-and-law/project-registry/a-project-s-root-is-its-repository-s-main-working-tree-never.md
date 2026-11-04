---
id: 01a1a758-94b3-7bf5-a2ef-09d4cc960a0c
title: A project's root is its repository's main working tree, never the parent of its git directory
ord: 14
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/projects/identity.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/git.ts
  - kind: file
    ref: packages/git/src/worktree.ts
---
A submodule keeps its repository in the outer repository's `.git/modules/<name>`, and a `--separate-git-dir` checkout keeps it anywhere; their `.git` is a file pointing there. Deriving the root as the parent of `--git-common-dir` registered `<outer>/.git/modules` as the project of a submodule, and git's own `worktree list` names such a repository's main worktree by its git directory, so coverage read the real tree as no repository and listed the git directory as an extra checkout.

So identification takes `--show-toplevel` when it stands in the main worktree (`--git-dir` equals `--git-common-dir`), and from a linked worktree the parent of a `.git` common directory, else the common directory's `core.worktree`; `worktreesOf` puts that `core.worktree` in place of a main entry holding no `.git`. Where the mark of a registered root lives is read through its `.git` file the same way (`commonDirAt`), or the former clone of a project moved onto a submodule would still answer for it.

Boundary: a linked worktree of a `--separate-git-dir` repository without `core.worktree` still falls back to the parent of the common directory: nothing in the repository names its main tree.