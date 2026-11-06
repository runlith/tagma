---
id: 01a14c05-9e8f-7c75-a633-b2a640beeb16
title: The palette finds projects, files, threads, blocks, commits and settings, runs actions and hands a question to an agent
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9276efa7d836
  - kind: relates
    to: 01a14be4-2437-75af-92bd-b4285e569cc0
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a2b526a4f0
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a3d7370c0e
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a70614903d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/CommandPalette.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Shell.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/palette/Palette.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/palette/Repo.ts
---
**Value.** The operator finds the needed place and runs an action from one field, and hands a question that no exact match answered to an agent.

**How.** Find or ask in the header and the palette chord; Quick Open immediately picks files. Groups, text prefixes and keyboard choice are available.

**Behaviour.** The palette merges projects, files, threads, blocks, commits, settings and owner actions, including those of apps. Groups expand and re-read independently; one's failure shows at it. Blocks narrow by tag and status, files jump to a position. Projects, files, settings and actions are found even by name with skipped letters or a typo; exact matches stand first. An action row shows its chord from the key table, so a person learns a key where he runs its action; a key press and a palette pick run the same action through the same handlers with one environment, so an action a focused place serves is listed and picked like any other. A plugin's action is listed only where the context project enables the plugin. Thread search switches between the project and all projects. Ask starts a new thread in the context project and sends the question asking to lean on the found links.

**Limits.** Global reach covers threads, not every group. Files need a selected checkout. Search inherits its owner's index completeness and shows its bounds; an agent answer is a separate run, not a synchronous search result.
