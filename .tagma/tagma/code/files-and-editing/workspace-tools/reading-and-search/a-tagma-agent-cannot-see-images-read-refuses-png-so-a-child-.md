---
id: 01a0db83-334e-78cd-be6d-3b8adefe0b26
title: "A Tagma agent cannot see images: read refuses PNG, so a child that must judge its own screenshots spawns an external Claude Code harness to look"
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "read refuses images and PDFs; the child spawned three harness:claude threads (control-ui-eyes, -eyes-2, -eyes-3) only to look at PNGs; two died on Tagma restarts without an answer, one is left running; 3 of 16 visual findings from the one pass that arrived are still open",
    "command": "child control-ui (thread 01a0db53-6f20-7f92-be84-de33b261f1f9, tagma agent, claude-opus-5-5) reads its own UI screenshots in a regression checkout's shots/control-ui/ to compare them with a design",
    "expected": "a Tagma agent can view an image file it produced (read returns image content to a multimodal model), so visual review needs no second process"
  }
---
The same limit hit the regression review earlier today: 16 Muse agents took 2 000+ screenshots they could not look at, and judged visual parity by pixel diffs and DOM text instead. The model behind every Tagma agent here is multimodal; the refusal is the read tool's, not the model's. Cost in this sighting: three external processes, two lost reviews (harness threads die with the host, see 941fe5bd), a stalled second visual pass. Related: 941fe5bd, c7266bee.