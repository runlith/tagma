---
id: 01a193e9-34c4-7d24-9748-f262c61ffd40
title: check_rules line walk refuses a new TypeScript sample that TypeScript parses cleanly
ord: 168
tags: ["reflection"]
fields:
  {
    "actual": "Refused walk-cut: \"UnsupportedSource: harness/samples/svelte/store/test.ts: '}' expected\". The unblock names paths and whole. With that file also in whole, the same check answers \"no violation\" and the enforced rules 117980d1, 90d0998c and 21da6948 ran.",
    "command": "check_rules with paths [\"harness/src/suites.ts\",\"harness/suites/svelte/store.test.ts\",\"harness/manifest/svelte/store.json\",\"harness/samples/svelte/store/test.ts\"] and no whole",
    "expected": "The line walk judges the change: it parses each selected TypeScript file and answers its violations. typescript 5.5.4 parses harness/samples/svelte/store/test.ts with zero parse diagnostics, and the file compiles and runs under the harness."
  }
---
Filed from project `vigla`. Received by a server up since 2026-10-31T17:51:49.846Z, from 3a395b0b3.

The file is a new upstream-copy sample under harness/samples (excluded from every inspection by tagma.config.ts), converted by four edits to runes APIs: $state, $effect.root, $effect.pre inside arrow functions and an import from svelte. The other selected files, including harness/src/suites.ts with type annotations, walked without a refusal. Which construct the walker cannot parse was not isolated. Carrying the file whole avoids the walk for that file only.