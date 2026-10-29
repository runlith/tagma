---
id: 01a1503a-648c-7ccd-9d40-62e217055fcd
title: Project installations are refreshed only by the server first raised on its own build; the developer's rollout never touches them
ord: 6
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/composition/junction.ts
    symbol: installationsRefreshed
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/installs/upgrade.ts
    symbol: refreshedFor
---
The `install_refresh` mark in the machine database keeps the build whose installations are already refreshed, and is written after the walk — even if individual projects refused: the next build, `tagma upgrade`, or the declaration check at CLI launch fixes them. One project's refusal never leaves the mark empty: otherwise every start would re-read every project's law. Only a failure of the walk itself (registry unread) skips the mark — then the next start repeats the walk.

The startup walk takes only projects whose installation stands in a checkout. The user level (skill and hooks in the CLIs' home directories) is rewritten at every start by the homes integration (`installHomes`) under its directory lock; lockless `installForUser` would write the same files at the same time as it.

Previously `tagma:cut` itself called refresh via CLI after a restart. Now the same restart raises the server on the new digest, and it refreshes installations itself; a second walk would run alongside the first, and `installSkill` deletes the skill directory and writes it anew — two writes would tear it.
