---
id: 01a14ffe-673f-7ade-b747-4f15604db4d1
title: rename refuses a case-only rename on macOS with an empty error
ord: 76
tags: ["reflection"]
fields:
  {
    "actual": "\"[rename] error: \" with no reason; the file kept its name. Worked around by moving through a temporary subdirectory (two rename calls)",
    "command": "rename {from: \"apps/tagma/app/src/lib/shared/theme.svelte.ts\", to: \"apps/tagma/app/src/lib/shared/Theme.svelte.ts\"}",
    "expected": "The file is renamed to Theme.svelte.ts, as the tool description promises for case-only renames on case-folding filesystems"
  }
---
Filed from project `runlith`.

Darwin 25, APFS case-insensitive, checkout /opt/workspaces/runlith. The same happened for theme.svelte.test.ts → Theme.svelte.test.ts in the same step.