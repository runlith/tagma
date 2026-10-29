---
id: 01a0f4aa-02d4-7a19-baaf-bdbcbbf9ebd0
title: "Tag step 1a: the declaration compiler with one extends and the composition law, preserving today's answers"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4f3-58a6-7ecc-9f98-b2015f7436e3",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46a6-7a7d-ae96-412c3743b582
  - kind: waits-on
    to: 01a0f4aa-02c3-7b01-b494-5e38f1c49a55
---
Builds [[3743b582]]. Implementation proceeds now on the operator's order; declaring the new format writable is the separate integration task [[3d39abda]]. Coordination and concrete seams: [[0f83e781]]. Class: **most complex** (claude-opus-5-5 `xhigh`). Scope: `graph/vocabulary/`, `graph/contract/wire/tags/`. Acceptance: [[3743b582]]'s — the compiler's refusals at write and at switch-on; every existing declaration answers as before; the resulting-schema cache per type and revision. Raises `vocabulary_format` only in a release after N.