---
id: 01a0cac7-fd7a-7e78-a023-efbdbd2fe52a
title: The skills toggle writes the effective disabled set to one layer, copying and stranding the other layer's silences
ord: 4
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/sections/SkillsSection.svelte
---
The skills toggle builds its write from the EFFECTIVE disabled set — `inventory.skills` resolved across both layers (`SkillsSection.svelte:74`, `configured()` over the union merge) — and writes that whole list to the layer on screen (`:76`). So switching off one skill on the project tab copies the user layer's silences into the project layer (a later re-enable on the user layer silently fails), and a skill silenced only by the other layer cannot be re-enabled from this tab: the write changes nothing effective and the switch flips back after reload. The switch reads effective state with no layer attribution, so the operator cannot know which tab to use — this breaks the layer-separation contract the catalog is built on.

Write the layer's own delta (or attribute the read), so each tab changes only its layer. Done when toggling on one tab neither copies nor strands the other layer's silences, with a test pinning cross-layer toggle independence.