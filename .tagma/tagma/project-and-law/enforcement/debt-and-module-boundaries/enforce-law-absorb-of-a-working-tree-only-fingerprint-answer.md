---
id: 01a13db2-1480-7889-b244-98fb8a9cb8d8
title: enforce_law absorb of a working-tree-only fingerprint answers success and changes nothing
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "The call answered enforced at the same revision 07cb57b07156, debt 0, and listed 3620 escaped entries measured at HEAD. The absorbed fingerprint was silently dropped; check_law still refuses the change on it. It cost a full remeasure (4.5 s) and an unreadable 650 KB answer.",
    "command": "enforce_law d270a238 base 07cb57b07156 strictness gate absorb [\"runlith-law:effect-style … requestObligation.itest.ts (top) test-runner ee00b970\"] owners {that fingerprint: \"7b27377d\"}",
    "expected": "Either the fingerprint check_law reported on this session's change becomes debt owned by 7b27377d, or the call refuses naming that the fingerprint does not stand at HEAD and what road moves a re-hashed site."
  }
---
Filed from project `runlith`.

A one-line consumer edit inside a test-runner call (`new ThreadCompaction({` → `makeThreadCompaction({` inside `Effect.runPromise(AgentHarness.make(...))`) re-hashes the whole site. The rule carries no debt: its 3620 standing sites are escapes measured at HEAD. A re-hashed site exists only in the working tree, so neither absorb nor escape can record it, and the only way through is rewriting the test file. The answer should say the absorb named a fingerprint absent at HEAD.