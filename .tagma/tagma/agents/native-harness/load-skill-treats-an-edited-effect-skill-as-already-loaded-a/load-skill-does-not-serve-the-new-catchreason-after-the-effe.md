---
id: 01a13f28-9717-7bfa-babc-67c2c93da993
title: load_skill does not serve the new catchReason after the effect4 change
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Got already-loaded pointing at the old payload, where the rule is missing. The new rule was read with a separate read of .agents/skills/effect4/SKILL.md:112–114; one extra step.",
    "command": "load_skill({skill:\"effect4\"})",
    "expected": "After commit f03506ea71 the call serves the new payload with catchReason/catchReasons."
  }
---
Filed from project `runlith`.
