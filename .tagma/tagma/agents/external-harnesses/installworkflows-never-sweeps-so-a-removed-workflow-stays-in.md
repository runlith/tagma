---
id: 01a0caeb-961f-7a58-b178-7e552fb35bb0
title: "`installWorkflows` never sweeps, so a removed workflow stays installed"
ord: 154
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/installs/skillInstall.ts
    symbol: installWorkflows
---
`installSkill` wipes its target before writing; `installWorkflows` only overlays. A workflow file removed from the source stays installed: it still reads current, and nothing ever sweeps it. Either the asymmetry is intended (workflows are additive) or the installer strands deletions.

Done when a removed workflow file stops reading current — swept like the skill, or stated as additive by design.