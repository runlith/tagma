---
id: 01a118f1-5f59-7eb8-856a-a0e3d68e71ff
title: "The app's thread view by subjects: thread tier, thread services, slot, feature contributions"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/threads
---
**Outcome.** The app's thread view (`apps/tagma/app/src/lib/features/threads`, `lib/wire`, `lib/features/pages`) splits into four part kinds:
- services bound to the thread through the existing thread tier;
- the screen slot, which only picks which thread to show;
- feature contributions gathered by composition;
- surface adapters by the thread's transport.

`HarnessHost` (`View.svelte.ts`, 1181 lines without imports, the [[6b3210c7]] debt) and `native/Conversation.svelte` (~80 props into `ChatSurface`) stop being hubs where every feature is written in.

**Kit or app.**
- **Kit** holds transcript, session, turn, feed and composer mechanics, plus kind and contribution registries as a mechanism.
- **App** holds everything that knows Tagma:
  - model and account settings;
  - approval mode and delegation;
  - compaction, recap, instructions, worktree, composition, skills, calls, pages;
  - words and preference storage;
  - server operations, shell navigation.

The app gives its view through the kit's declared contracts: product entry-kind and tool renderers, composer contributions. It never repeats the kit's mechanics — folding, row life, scroll. The kit imports no app type.

**Parts.**
- [[e5e1e307]] — `ThreadRung` as the sole authority over thread life, thread services, `ThreadSlot`, `ThreadBirth`, operations and connection; migrating the existing thread-tier services and pages.
- [[e4e28eab]] — feature contributions; `Conversation.svelte` only composes; chat/terminal surface adapters.
- [[13bda205]] — thread list at hundreds of rows and dozens live.

**App acceptance.**
- In `features/threads` no source file past 650 lines by the [[6b3210c7]] count. The `View.svelte.ts` debt entry leaves.
- Race behavior checks:
  - an answer arriving after the slot's thread change never touches the new thread;
  - a destroyed service's work publishes nothing.

  Checked by service tests, not by the absence of specific guards in code.
- The thread view's #module card is written from the new code: root, entries, imports, order. The "Dump" rules touching it move under it.
