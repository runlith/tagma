---
id: 01a14b88-6815-74e7-92a7-7fe6d7054dbe
title: "Change record treats a case-only collision on a case-insensitive filesystem as two paths: the new file is \"untracked, mine\", the tracked lowercase twin \"modified by nobody\""
ord: 20
tags: ["reflection"]
fields:
  {
    "actual": "read_changes listed `Tooltip.svelte · untracked · this session +52` and `tooltip.svelte · modified · nobody +48/−3 (written outside the record)` for the same file on disk; git status showed ` M tooltip.svelte`. A commit from that state would keep the lowercase name and break the `Tooltip.svelte` imports on a case-sensitive checkout. Worked around with one `git mv tooltip.svelte Tooltip.svelte`, after which git shows `RM tooltip.svelte -> Tooltip.svelte`.",
    "command": "delete apps/tagma/app/src/lib/shared/ui/tooltip/tooltip.svelte, then rename apps/tagma/app/src/lib/shared/Tooltip.svelte → apps/tagma/app/src/lib/shared/ui/tooltip/Tooltip.svelte (macOS APFS, core.ignorecase=true); read_changes path apps/tagma/app/src/lib/shared/ui/tooltip",
    "expected": "One path: the tracked tooltip.svelte deleted and Tooltip.svelte added by this session, so submit_work lands a case rename and the commit carries Tooltip.svelte."
  }
---
Filed from project `runlith`.

The delete tool reported the lowercase file deleted, and the rename tool then wrote the capitalised name over the same directory entry. The record keys paths by spelling, while the filesystem and git (ignorecase) key them case-insensitively, so the deletion vanished and the content got credited to nobody.