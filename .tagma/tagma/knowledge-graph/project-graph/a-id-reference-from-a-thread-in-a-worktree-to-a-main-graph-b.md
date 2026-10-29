---
id: 01a11975-10cf-7351-a1c6-2c9e5e24d5b6
title: A [[id]] reference from a thread in a worktree to a main-graph block leads to “Not on this branch”
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "The app looks for the block in the branch copy picked in the switcher and shows “Not on this branch: 00675936 is not in foundation-refactor”. All ten report references never opened; the [[id]] syntax cannot name a graph copy",
    "command": "An agent in a thread standing in the foundation-refactor worktree wrote [[id]] references in the operator answer to reflections made in the main graph; the operator clicked a reference",
    "expected": "A reference opens the block where it lies (in the main copy), or itself names its copy; an agent can write a working reference to another copy's block"
  }
---
Filed from project `runlith`.

A shared root with [[00675936]] and [[cead8015]]: references, edits and closes do not know in which graph copy the block lives. The workaround is switching the branch back to main by hand.
