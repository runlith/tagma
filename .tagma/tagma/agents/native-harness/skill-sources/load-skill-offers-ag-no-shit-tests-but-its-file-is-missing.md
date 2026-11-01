---
id: 01a16e6b-8c2f-7df9-a39a-fec293923d2e
title: load_skill offers ag-no-shit-tests, but its file is missing
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "The tool answered ENOENT for ~/.claude/skills/ag-no-shit-tests/SKILL.md; instructions not loaded.",
    "command": "load_skill({\"skill\":\"ag-no-shit-tests\"})",
    "expected": "A skill declared in the tool either loads, or a missing skill is not offered in the enum."
  }
---
Filed from project `runlith`.

Met during a read-only audit of integration tests; the audit itself continues under the full 4f387de2 norm delivered in prompt.
