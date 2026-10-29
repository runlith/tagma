---
id: 01a13c1b-6c8e-7409-911b-12f4021983df
title: load_skill treats an edited Effect skill as already loaded and does not serve the new revision
ord: 47
tags: ["reflection"]
fields:
  {
    "actual": "After the relay about the skill change the call answered status already-loaded and offered re-reading the old visible history; the new code-shrinking item was missing there. The current revision had to be read separately via read — one extra call.",
    "command": "load_skill({\"skill\":\"effect4\"})",
    "expected": "After editing .agents/skills/effect4/SKILL.md a repeat call serves the current revision of the instructions."
  }
---
Filed from project `runlith`.
