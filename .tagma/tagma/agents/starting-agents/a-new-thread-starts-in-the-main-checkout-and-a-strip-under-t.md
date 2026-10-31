---
id: 01a18d75-6b24-769b-b352-5daf41511b78
title: A new thread starts in the main checkout, and a strip under the composer shows and picks where it runs
ord: 11
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03cf5e92d5db
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03d2b3b3a55f
  - kind: relates
    to: 01a18d49-8332-708f-85d5-3198619987f6
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/birth/BirthPlace.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/place/strip.composer.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/place/Strip.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/worktrees/acts.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/worktrees/GroupHeader.svelte
---
**Value.** A quick task meant for the main checkout no longer lands in the worktree of whichever thread was opened last: where a thread runs is chosen on purpose and stays in sight right under the field the operator types in.

**How.** The strip under a draft's composer; "+" on a worktree's header in the By worktree view and New agent here in its menu, on the switcher's worktree card and on the worktree board; the header switcher while a draft is open.

**Behaviour.**
- Each new-draft act starts in the project's main checkout, whatever thread was open before: the column's "+", New agent, New thread as, the palette, and "+" on the phone. The unsent draft keeps its text and model choices.
- A place picked for a draft (the main checkout, a worktree, or a new worktree from a base branch) stays through thread switches and page reloads until the draft is sent. The next draft starts in main.
- The strip shows Main checkout, or Worktree with its name in the worktree's own tone, with the branch on the right. A new worktree shows "from <base>" with a picker of the branches the project's checkouts stand on, and is made with the draft's first message.
- The strip stands only while a draft is open. Once the first message is sent it leaves, and the header switcher, which follows the open thread, names where the thread works. Moving a thread stays in the thread menu.
- The window frame follows an open draft the way it follows an open thread, so the header switcher and the strip name the same place. Picking a place in the switcher while a draft is open sets the draft's place.
- A project folder that holds no Git repository shows only its folder name, with no branch and no menu.

**Limits.** A CLI agent launched from the column's "+" menu is born in the open draft's place, and in the main checkout while a thread is open. When a worktree chosen for a draft is deleted before the send, the strip shows it as deleted until another place is picked. The strip gives a new worktree no name: it takes a provisional branch that follows the thread's title.
