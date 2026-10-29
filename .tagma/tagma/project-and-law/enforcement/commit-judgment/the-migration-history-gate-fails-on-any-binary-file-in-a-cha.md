---
id: 01a13647-0002-71ac-b018-72d3c66c7a7e
title: The migration-history gate fails on any binary file in a change, so a commit carrying an image cannot land through submit_work
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "refused[inspection-failed]: the tree input could not read apps/tagma/desktop/assets/Tagma.icns: … is not UTF-8 text; nothing landed, and the only road left is a direct git commit",
    "command": "submit_work {checkout: /opt/workspaces/runlith, paths: [\"apps/tagma/desktop/assets\"]} — the paths hold Tagma.icns, dmg-background.tiff, dmg-window.DS_Store and two SVGs",
    "expected": "d81b1676 judges only migration directories and table manifests, so files outside them — binary ones included — are not read and the commit lands"
  }
---
Filed from project `runlith`.

The rule's reach covers the whole tree, and its tree input decodes every changed file as UTF-8 before deciding whether the file is a migration. A binary asset anywhere in a change therefore fails the gate, and a failed gate refuses. Workaround used: one `git commit -- apps/tagma/desktop/assets` (rule 35be02f0). Earlier sighting of the same rule failing to judge: 0e651b57.