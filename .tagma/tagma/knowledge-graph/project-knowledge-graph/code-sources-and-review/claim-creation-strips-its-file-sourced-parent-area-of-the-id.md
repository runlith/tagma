---
id: 01a0cab3-9c9e-7bcf-89cd-d16764bd0a57
title: Claim creation strips its file-sourced parent area of the identical file anchor
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "The area silently lost its file source to the newborn: a same-file claim created under a file-sourced area moves the area's exact anchor onto itself. Measured in the app cover wave: [[4ada7f17]] lost 6 of its 7 file sources, [[b70292cb]] lost its only file source (sourceless area), [[2f69b0c4]]'s [[c04717c7]] lost 3 of 5 — and `main.ts` was lost a second time when a repair claim bound it after the re-anchor. Owner lookup of the stripped files then reaches only the module, and each zone pays a repair round-trip to re-anchor. Dir-sourced areas are unaffected (no claim carries a dir source), so the blast radius is exactly the file-sourced areas — here the build, ink, desktop, terminals and harness zones.",
    "command": "create_block (and apply_batch create) with parentId set to a file-sourced #area and a file source identical to one of the area's file sources",
    "expected": "The area keeps its territory sources and the newborn claim carries its own evidence source beside them; owner lookup of the file still reaches the area"
  }
---
Filed from project `runlith`.

The transfer rule is documented on create_block ("an exact anchor on the direct parent transfers to the child"), so the server behaved per spec — the spec is what breaks containers: an area's file sources are its territory, and a claim binding the same file as evidence must not strip the territory. The workaround in use: builders re-anchor the area's file sources after creating claims (anchor does not transfer), and reviewers check area sources. That holds the wave; the rule still needs a container-aware form (transfer only where the parent is not a container, or never for file/dir territory).