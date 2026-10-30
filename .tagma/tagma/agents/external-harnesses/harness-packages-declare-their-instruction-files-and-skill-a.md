---
id: 01a18e9a-32ba-7648-9253-521cb73015a7
title: Harness packages declare their instruction files and skill aliases
ord: 204
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/installs/targets.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/installs/law.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/installs/skillInstall.ts
  - kind: symbol
    ref: packages/tagma/src/adapter/harness.ts
    symbol: InstructionSurface
---
The canonical skill belongs to the installation, while a CLI's instruction files, import syntax and skill aliases belong to its package. User and default-home installs refresh one canonical copy; isolated accounts keep theirs within the account directory. Every path links its declared alias instead of rewriting that alias as a separate copy, so a release cannot leave the canonical skill stale. Upgrade recognizes earlier declared user aliases, and native discovery excludes the canonical skill and its aliases so Tagma's own instructions are not offered twice.