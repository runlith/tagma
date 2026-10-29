---
id: 01a10284-da13-7e0c-9742-a42dbdf213a2
title: Client thread feed updates proportionally to the change, not the whole feed
ord: 36
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e82-7d14-8692-a66c063a90f8",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/Conversation.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/View.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/ChatFold.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/ChatSurface.svelte
  - kind: file
    ref: packages/chat-ui/src/ChatTranscript.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/AssistantMessageRow.svelte
  - kind: file
    ref: packages/chat-ui/src/entryProjection.ts
  - kind: file
    ref: packages/chat-ui/src/MessageNav.svelte
  - kind: file
    ref: packages/chat-ui/src/timeline.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
---
**What.** The client thread feed updates proportionally to the change: stream deltas and `updated` touch only the changed entries.

**Why (perf audit 2026-10-03; from code, client CPU not measured).**
1. On every stream chunk (`ChatFold.applyStreamMessage/placeStreamEntries`, `packages/chat-ui/src/ChatFold.svelte.ts:287-377`; `entryProjection.ts:75`): projecting the whole run message with `join().trim()`, `filter` and `findIndex` over N per entry — O(P·N), a new entries array and a cascade: `timelineEntries`/`openConfirmations`, `visibleChatEntries`, `chatTimeline` (`timeline.ts:148-357`, ~3 allocations and `new Date` per element), `timelineByKey`/`rowKeyByEntry` maps, `MessageNav.svelte:14` (`split(/\s+/)` of every user message), `identityAims`/`launchTitles` (`apps/tagma/app/src/lib/features/threads/native/Conversation.svelte:132-172`), `requestMeta` (`findLast` + `find` per mounted assistant row, `entries/AssistantMessageRow.svelte:14`). `TranscriptVirtualizer.svelte.ts:288` hands a new `getItemKey` every time — tanstack 3.17.8 drops memo and remeasures everything; then `anchorEnd` forces layout.
2. Every `updated` (`apps/tagma/app/src/lib/features/threads/View.svelte.ts:1225,1236-1242` → `ChatFold.restoreSnapshot/projected`) creates all N `ChatEntry` anew, although `foldThreadTranscript` keeps untouched identity: `reuseTimelineItems` reuses nothing, all mounted rows redraw, assistant rows lex markdown again and remeasure (`ChatTranscript.svelte:176-193`).
3. `TranscriptVirtualizer.rows` is a deep `$state`, published on every scroll and measure.

**Direction.** The fold holds an id→position index and changes only the streaming entry; the `updated` projection carries untouched entries by identity; timeline and derived maps update over the affected segment; `getItemKey` is stable; `requestMeta` is computed in the fold once per run; `rows` is `$state.raw`.

**Done when.** A stream delta on a feed of N entries costs O(change) outside one row's render; `updated` does not change untouched entries' identity and does not redraw them; feed order and content are unchanged; delta cost at N ∈ {100, 1000, 5000} is flat.
