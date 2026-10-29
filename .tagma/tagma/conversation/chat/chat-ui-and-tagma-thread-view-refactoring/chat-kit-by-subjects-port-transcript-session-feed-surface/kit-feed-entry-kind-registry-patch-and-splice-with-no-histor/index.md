---
id: 01a118f1-5f59-7eb8-856a-a0e18d75d711
title: "Kit feed: entry-kind registry, patch and splice with no history scan, pinned region and live rows"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatTranscript.svelte
  - kind: file
    ref: packages/chat-ui/src/TimelineFold.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/VisibleFeed.ts
---
**Outcome.** How a feed row looks and behaves is declared by its kind, and a new kind joins by registration with no kit edit. The feed has two regions that outlive scrolling. Changing one entry's content costs work on that entry, not on history. A structural change costs work on the affected structure.

**The `EntryKinds` entry-kind registry (the `feed/` floor).**

A kind's descriptor:
- `kind`;
- the payload type (from its producer's schema);
- `classify`: meta, rail, verbose-only, hidden;
- `estimate` — the height estimate;
- the renderer, typed by the same payload;
- `keepAlive` (optional).

The "kind → payload → renderer" link is held by the descriptor's type, not `string` + `unknown` + cast. The kind's properties, now scattered over the `timeline.ts`, `rowEstimate.ts`, `VisibleFeed.ts` and `chatEntryRenderer` switches, move into the descriptor.

The `fromEntry` projection and the store stand below, on the `transcript/` floor. A product kind's entry passes with its typed payload; no session registry is needed.

Who registers:
- the kit — the agent transcript's own kinds;
- the app — product entry kinds, one feature per kind: worktree move, transport change, composition. Now these are the `feedRecords.ts:8-16` and `Conversation.svelte:457-465` if-chains.

The `plugin` kind with `data: unknown` goes away. Each product kind's schema sits with its server module, validation on input closes over the set kinds ([[c3436715]], with no upward agent dependency, [[e090f46d]]).

The registry is an instance that composition assembles. Registration returns a disposer. A kind's renderer needs no app types: the app's wrapper finds its own owner.

**Refusals — each with its own answer.**

| Case | Who answers | What shows |
|---|---|---|
| entry failed the schema | producer: typed decode error and diagnostics | — |
| type not set on input | producer: typed decode error and diagnostics | — |
| kind arrived, no renderer | kit | a diagnostic row naming the kind |
| kind hidden deliberately (`classify: hidden`) | kit | nothing |

Now an unknown type falls into `[]` (`entryProjection.ts:463`), and a known type casts with no check (`:289-292`). A kind with no renderer gives an empty row (`ChatTranscript.svelte:523-526`), an unknown `pluginKind` nothing (`Conversation.svelte:457-465`).

**Tool renderers.**
- The key is the tool name; the renderer is declared by the feature owning the tool. The static `Conversation.svelte:301-304` entry goes away.
- A tool's descriptor may give `modelText(output)`.
- "Refused" reads from the settled call's outcome (`refused` with a code, the producer's settlement projector). So `toolRefused` and output-shape sniffing (`Conversation.svelte:582-591,604-605`) go away.

**Changes: patch and splice.** The store yields two change kinds.
- **Content patch** — the entry with an id changed, store positions the same: text-delta, tool-state change. The floor finds the entry's row by the id → row index. When the row's classification, grouping or visibility never changed (an ordinary text append), it changes only it. When they changed — a settled call leaves the live tail for its activity group (`VisibleFeed.ts:142`, `activity.ts:69-118`, `TimelineFold.ts:330-371`) — the floor turns the patch into the affected groups' splice for the next floor. Work over unrelated history is forbidden, not the structurally right result downstream.
- **Structure splice** — `{from, removed, inserted}`: a new entry, older-items load, withdraw removal, regrouping. The floor recomputes the affected segment.
- One event touching several non-adjacent entries arrives as one atomic change batch.

Rewind never removes entries. It sets and clears marks (`eventFold.ts:56-70,97-99`), and these are mark patches: feed grouping (`timeline.ts:127-131`) recomputes only the affected groups.

Now the changed is found by comparison and history copies on every delta:
- `ChatFold.svelte.ts:444`;
- `VisibleFeed.ts:67-70,88-90`;
- `TimelineFold.ts:116-127,255`.

Floor structures are picked so a splice at the feed head never rewrites the tail element-wise past the affected: a row's position computes, never stored in every row. Interludes are found by index, not by a per-row scan (`ChatTranscript.svelte:527-533`).

**Pinned region (`pinned`).**
- Stands above the feed outside the scroller and never moves on scroll.
- Takes its height from the feed's viewport under the clearance contract, like the composer. Its growth keeps the read position and follow.
- Content is mountings from contributions. Layout is the surface's.
- Pinned stays pinned on all the operator's devices: the pinned set is a server-side thread fact, not a client setting. Storage appears with the first real pinnable contribution (the plugins spec). The region takes the set from that owner.
- `beforeEntries` and the unused `footer` go away.

**Live rows (`keepAlive`).**
- A row of such a kind, already mounted, never unmounts when leaving the virtualization window: the same DOM node in its place. Its index joins through tanstack's `rangeExtractor`. Historical rows never pre-mount.
- Outside the window the row is `inert`: focus and accessibility lifted, measurement continues.
- Budget is 4 held rows outside the window per surface. A live row is usually a widget with its own document, and that is tens of megabytes on a weak machine ([[fe83acfa]]). Four cover the table and neighbouring live results. Past the budget the longest-unseen goes away; on return it mounts anew, and the contribution's owner holds its state.
- A row goes away when its entry is removed, hidden by a collapsed group or verbose filter, when the thread on the surface changed or the surface unmounted. Inside a collapsed group keep-alive never applies: the group's row is the feed's unit.
- Keeping the DOM node never makes the node the state owner. What must outlive unmounting is held by the contribution's owner.
- Height changes go through the shared ResizeObserver. The descriptor's contract: animation runs in a stable-height box, because a row's growth on bottom-follow re-anchors the feed (`TranscriptVirtualizer.svelte.ts:256-271`).

**Feed memory is the view's.**
- Row measurements and expansions (`TranscriptVirtualizer.svelte.ts:16,43,327-328,365-378`, `surface.ts:34`) are view state. The slot's feed memory owns it: the key is the thread, LRU over 8 threads. This is a count ceiling: measurements are numbers over mounted rows, kilobytes per thread, and eight covers one slot's returns. This LRU has no link to `DetachedSessions`: the slot's and the connection's returns differ.
- The measurement keeps the expansion state it was taken under. A feed-width or expansion change resets the affected measurements.
- Static caches over 16 threads go away.
- Message navigation finds the node inside its own feed, not `document.getElementById` (`TranscriptViewport.svelte.ts:178-187`).

**How to check (performer).**

Registry:
- a registered kind renders with its renderer;
- a kind with no renderer gives a diagnostic with the name;
- a hidden kind — nothing;
- after the disposer — diagnostics.

Changes:
- a tool-state patch moves the call from the live tail to its settled group with no doubles or skipped rows, and unrelated groups keep identity.

Regions:
- pinned keeps the DOM node on scroll, feed growth and its own resize; the feed viewport shrinks by its height; the read position never jumps;
- a live row keeps the node outside the window and on return, outside the window it is `inert`;
- past the budget the longest-unseen goes away;
- group removal and collapse take the row away.

The algorithm bench `transcriptDelta.bench.ts` is in CI, with no DOM. Path: patch into the store → visible feed → timeline → virtualizer row model (count, key, estimate). Three independent axes:
- history: 100 and 10 000 entries;
- live run parts: 1 and 200;
- a growing entry's body: 100 and 100 000 characters.

Budget: the median of ≥ 20 patch measurements on each axis's large end is at most twice the median on the small. Both sides measure in one process, so the ratio barely depends on the machine. Now the bench pins six tools and ~200 tokens and misses the budget (`:73-93`).

The observer scenario ([[33589ccf]]) in the browser measures virtualizer and DOM cost. The algorithm bench never proves it and never claims to.
