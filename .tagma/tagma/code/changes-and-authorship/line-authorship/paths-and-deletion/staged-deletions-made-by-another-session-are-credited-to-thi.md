---
id: 01a1365f-d1ee-7418-84dc-ffbf11a17b73
title: Staged deletions made by another session are credited to this session as held lines
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "read_changes lists them as this session's held deletions, attributed to run 01a13656-31d9-7fc3-a107-04fa390abe1f. submit_work reports them as \"lines of this session still stand uncommitted\". Landing them would break apps/tagma/app/src/lib/app/chrome/layer.ts, which still imports them; the first submit_work, given that directory, refused on 50520d64 for exactly that. The thread cannot end without holding them, and cannot land them either.",
    "command": "read_changes (session 01a13620-38ed-786c-8629-dfdc6e7a44e0) after submit_work landed 5ee9923554",
    "expected": "8 files under apps/tagma/app/src/lib/features/worktrees (Listings.svelte.ts, Space.svelte.ts, places.ts, placeViews.ts, LoadCleanupButton.svelte, LoadPlaceActs.svelte, LoadPlaceName.svelte, SpacePanel.svelte) are attributed to the session that deleted and staged them (index shows `D `). This session never touched them."
  }
---
Filed from project `runlith`.