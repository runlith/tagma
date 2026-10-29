---
id: 01a18436-f7f0-70bf-ad68-26ab8edde06f
title: Platforms reuses a warm result without checking a changed generated config
ord: 143
tags: ["reflection"]
fields:
  {
    "actual": "The commit landed. The platforms package contribution memo reused the clean app result without rechecking the generated config; the native-door regression failed on the expected inspection-failed refusal.",
    "command": "submit_work paths=[own.ts] through makeThreadDoors after enforce_rule warmed platforms and a peer rewrote the ignored app/.gen/tsconfig.json",
    "expected": "A genuinely stale built copy refuses once as inspection-failed, naming the tracked copy and generated output, as the generated-config contract requires."
  }
---
Filed from project `tagma`.

Encountered while fixing [[df7302db]]. The regression is apps/tagma/server/src/composition/testing/enforcement/generatedLanding.itest.ts; its pre-fix run reported an answer with submitted.status=landed after the ignored output's exclude changed. The root is freshness validation occurring only while resolving an import, after platform contribution reuse can already return.