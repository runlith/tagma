---
id: 01a18d49-8332-708f-85d5-3198619987f6
title: A new thread starts in the main checkout, and a strip under the composer shows and picks where it runs
ord: 28
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/birth/ThreadBirth.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/FrameFollow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/WorktreeSwitcher.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/worktrees/Chip.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/worktrees/GroupHeader.svelte
  - kind: file
    ref: packages/chat-ui/src/Composer.svelte
---
## Why

A new thread starts where the window frame points, and the frame moves by itself. `ThreadBirth.where` takes the draft's place from `places.aimed`; `FrameFollow.svelte` re-aims the frame at the worktree of every thread opened. So opening a thread that works in a worktree and pressing "+" starts the next task in that worktree, and the only sign is the header switcher, away from where the person types. A quick fix meant for main lands in a feature worktree and is noticed after the work is done.

## What changes

**The draft owns its place.** A new draft — the column's "+", New agent, the palette — starts in the project's main checkout, whatever was open before. A draft starts elsewhere only by an explicit act on that place:
- "+" on a worktree: a hover action on the worktree header in the By worktree view and an item in the worktree menu, as a folder already offers "New agent here";
- choosing a place in the strip below.

**A context strip under the composer.** The composer card gains a plain row beneath it, with no surface of its own; the chat kit declares the region, the threads feature fills it. Left, the place picker; right, the branch.
- Main checkout: the main-checkout diamond and "Main checkout"; right, its branch.
- A worktree: its diamond, "Worktree" and its name, the row tinted in the worktree's own tone; right, its branch.
- A new worktree: the dashed diamond and "New worktree"; right, "from <base>" with a picker of the base. It replaces "Draft in a new worktree" in the header switcher.
- Menu: Main checkout, the project's worktrees, New worktree; the chosen one carries the gold check.
- A project with no repository: the strip names the project folder alone, with no branch and no menu.

**The strip stays on a running thread, read-only.** It shows where the thread works, with no pickers. The worktree chip in the thread heading goes: a thread's place is shown in one place. Moving a thread to another worktree stays in the thread menu.

**The header follows the open draft.** The frame follows an open draft's place exactly as it follows an open thread's, so the header switcher and the strip always name the same place; choosing a place in the switcher while a draft is open sets the draft's place.

The composer action row — attach, approval mode, Team, model — does not change: it says how the agent works, the strip says where.

## Decided, and why

- **Default is always the main checkout.** Remembering the last chosen place was rejected: it is the same trap, merely visible. Whoever works in a worktree picks it with one click or starts from the worktree itself.
- **A row of its own under the composer, not one more chip in the action row.** A fifth control among the action buttons is easy to miss; a separate row directly under the field is read before sending.
- **One place per fact.** The heading chip and the "Draft in a new worktree" switcher action go to the strip, so place is chosen and shown in one spot.

In a group of projects (the spec this relates to) the strip carries a project picker before the place, and the default is the first member's main checkout.

## Acceptance criteria

- Open a thread working in worktree X, press "+": the draft's place is the main checkout, the strip reads Main checkout, the header switcher shows main.
- Choose worktree X in the strip and send: the thread is born in X; the header shows X.
- "+" on worktree X's header starts a draft in X.
- New worktree in the strip with a base: the first message creates the worktree from that base and the thread is born in it.
- A running thread shows its place in the strip without pickers; the thread heading carries no worktree chip.
- A project without a repository shows only its folder in the strip.
- Typecheck and the affected packages' tests pass; minimal contract tests through the thread birth door: a new draft's place is main regardless of the frame, an explicit place is kept until send.
