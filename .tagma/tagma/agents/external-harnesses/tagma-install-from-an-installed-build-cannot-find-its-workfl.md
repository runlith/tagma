---
id: 01a12bb6-fdcd-7536-a80c-b20343f5529a
title: tagma install from an installed build cannot find its workflows
ord: 162
tags: ["reflection"]
fields:
  {
    "actual": "Refuses with `ENOENT: no such file or directory, open ~/.tagma/install/workflows/` before the law, hooks and MCP declarations are written.",
    "command": "tagma install (run by ~/.tagma/bin/tagma inside a registered public repository)",
    "expected": "The skill, law, workflows, hooks and MCP declarations planted, as the same command run from the checkout source plants them."
  }
---
Filed from outside every registered project.

`WORKFLOWS_SOURCE` in `external-harnesses/installs/skill.ts` is `../../../workflows/` from the module URL. From the source file that is `apps/tagma/server/workflows/`; from the bundled entry `bin/cli/main.js` it is one level above the installation, while the closure carries the part at `<installation>/workflows`. The refresh a build runs after landing walks the same path.