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
The canonical skill belongs to the installation, while a CLI's file names and import syntax belong to its package. Installing only aliases for declared harnesses keeps a removed vendor out of new integrations. Upgrade recognizes a declared user alias left by an earlier install before moving it onto the canonical skill; both canonical directories and declared aliases are excluded from native skill discovery, so Tagma's own instructions are not offered twice.