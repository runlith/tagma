---
id: 01a1ad93-7301-7436-95d4-1a265fe88923
title: A new journal form step declares back forms that take its records to what the build before reads
ord: 9
tags: ["rule"]
edges:
  - kind: relates
    to: 01a1ad3a-f940-7727-920c-1581a3d3b323
sources:
  - kind: dir
    ref: apps/tagma/server/src/threads/steps
  - kind: dir
    ref: apps/tagma/server/src/native-harness/steps
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/steps
  - kind: dir
    ref: apps/tagma/server/src/tagma-apps/steps
  - kind: dir
    ref: apps/tagma/server/src/graph/steps
  - kind: dir
    ref: apps/tagma/server/src/enforcement/steps
  - kind: dir
    ref: apps/tagma/server/src/worktrees/steps
---
`back` holds, for each record kind the step changes, the form that undoes it; it is empty when the build before reads the new form as it is. A step back runs these forms over every record the leaving build wrote, newest step first.