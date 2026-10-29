---
id: 01a13215-016c-74b7-ab7a-5b022badeaf8
title: Gated inspections fail on a committed symlink in the change tree
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The whole submit refused: rules 55b5437b and d81b1676 \"inspection failed (git): the tree input could not read regular files: .agents/skills/\", though neither rule's reach covers .agents/. The only way out was replacing the symlink with a copied file, so a project skill can no longer live in its owning package and be linked in.",
    "command": "submit_work with paths including .agents/skills/ (a git symlink, mode 120000, to ../../packages/)",
    "expected": "Inspections judge the source files of the change; a symlink entry is followed or skipped as a non-source path, and the commit lands."
  }
---
Filed from project `runlith`.

Session mask-boundary (task 966f82e9, runlith). The symlink exposed a developer adapter's skill as a project skill; SkillDirectories follows symlinked directories via fs.stat, so the product side worked.