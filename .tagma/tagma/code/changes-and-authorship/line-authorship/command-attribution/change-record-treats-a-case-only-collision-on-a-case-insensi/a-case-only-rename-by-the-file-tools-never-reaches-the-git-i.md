---
id: 01a14fff-9de5-70ba-9f53-83d947768c8f
title: A case-only rename by the file tools never reaches the git index on a case-insensitive checkout
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "git status showed \" M theme.svelte.ts\" (core.ignorecase): a commit would keep the lowercase name and break the PascalCase import on Linux. Fixed with one `git mv -f` command",
    "command": "rename theme.svelte.ts → theme/Theme.svelte.ts → Theme.svelte.ts (two calls, since the direct case-only rename failed)",
    "expected": "The change record and git see a rename theme.svelte.ts → Theme.svelte.ts that submit_work can land"
  }
---
Filed from project `runlith`.