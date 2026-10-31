---
id: 01a123c2-d0f6-7242-82d0-75aa8e034399
title: One feature declares a settings section and others contribute into any section; the settings page renders every section's contributions
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/section.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/SectionRegistry.ts
---
A feature declares its sections in its `settings.ts` and contributes them to the `SettingSections` point from its own layer. A block for someone else's section is a `SectionContributions` item naming the section id, its order and a `{ component }` payload. The settings page renders the active section's contributions after its own view through `PointView` (`only` by section), so no section opts in and none keeps its own loop. The settings module loads nothing below the features, and a root outside the core contributes the same way.

A second section with one id, or a second section holding a setting key another holds, refuses at admission and names both contributors. That contribution's start fails through `Failure`, and the first holder stays. A contribution to a section this build does not declare renders nowhere instead of refusing, so a feature that contributes into another feature's section still loads when that feature is absent.