---
id: 01a14c05-9e8f-7c75-a633-b2abc2918809
title: Shell shows refusals, collects repeating window failures, and offers available Undo
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-7696-71f4-8eeb-ff1e8a780ecb
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2aaba2d4d54
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/FaultsButton.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NoticeCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NoticeCards.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/ServerFaults.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/notices/Offer.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/notices/Service.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/activity/faults.ts
---
**Value.** The operator tells a refused action apart from a failed request, can read the cause, and can quickly undo some actions.

**How.** Notices cards over the page, an Errors button in the status bar, and Undo on actions whose owners provided it.

**Behaviour.** A refusal with exits is shown as a card; repeats of the same message merge with a counter. A refusal whose code the composition filled with an `Offer` is not an error but a calm card with that offer's action: that is how the demo answers `demo-unavailable` with a Get Tagma button. The Errors button holds one list: server defects from activity — those that stopped work and those survived by the run — grouped by place and message, with count, age, and thread link — and failures of this window: unexpected request failures, exceptions caught by part boundaries, and unhandled exceptions and promise rejections — with place, message, stack, and repeat counter. Copy takes the message with stack, thread, run, and activity. The server part arrives as a live feed and stays the same after a window reload and server restart, while the fact lives in the activity storage window. Clear marks on the server, and server rows leave all windows; a defect that repeats returns as a row. The button is visible while the list has rows. An agent reads the same list with the `read_faults` operation. A temporary Undo lives only while its action and its scope live; closing the card does not change the original result.

**Limits.** Window failures are known only to that window and do not survive its reload. The list is neither Attention by thread nor the server journal: it holds only defects, not refusals and not log warnings. Undo is not universal: the inverse-action function belongs to the calling feature. The Errors button collects no diagnostic archive and takes no profiles.
