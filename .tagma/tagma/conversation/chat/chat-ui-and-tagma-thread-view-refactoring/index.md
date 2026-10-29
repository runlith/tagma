---
id: 01a118f1-5f59-7eb8-856a-a0deb7bb8a8f
title: Chat-ui and Tagma thread-view refactoring
ord: 37
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Outcome.** The Tagma chat — the `packages/chat-ui` kit and the app's thread view (`apps/tagma/app/src/lib/features/threads`, `lib/wire`, shell mountings) — is built so:
- one owner holds one thread's facts, while the screen slots where the thread shows only hold it;
- a thread feature adds composer commands, entry views, tool renderers, mountings, sections and panels with new files and its own declaration, without editing central files;
- the client never re-derives facts the runtime knows;
- a change of an entry's content scans or copies history on no floor, and a structural change costs work on the affected structure;
- closed shell lists are replaced by registries.

On this foundation plugins, modes and similar schemes are designed later: [[21acc718|the plugin idea]], acceptance — [[9caf5753|the poker tournament]].

**Why.** Three structural reasons. The 2026-10-07 audit — code reading without measurements, then independent verification against HEAD `41468abe`/`03f69b1d`.

1. **No thread-session owner.** A `HarnessHost` (`features/threads/View.svelte.ts`) creates the thread fold (`ChatTurns`/`ChatFold`) — one per slot: main column, side panel, mobile shell. On switch the slot clears the fold and rebinds it to another thread. The server subscription is already shared while held, but:
   - two holders of one thread fold it twice;
   - after the last reader leaves, returning means a full snapshot;
   - the open timer never lifts when the host dies;
   - the panel writes identity both ways (`app/panes/SidePane.svelte:43-55`);
   - the existing thread tier (`features/threads/Rung.ts`) already holds the `ThreadPages`, `OpenFile`, `ContextPanelState`, `ThreadChanges` services, but does not yet own the fold and what `View.svelte.ts` holds: the slot's `HarnessHost` builds that.
2. **Composition hubs have no contribution points.** Every thread feature is hand-written into `View.svelte.ts` and `native/Conversation.svelte`: slash commands (catalog + name if-chain), chips, panels, product entry views, tool renderers; `ChatSurface` takes ~80 props. Since 15 September `View.svelte.ts` changed in 36 commits, `Conversation.svelte` in 45, and `View.svelte.ts` refused commits five times under [[6b3210c7|the 650-line rule]].
3. **The runtime→chat contract is erased and re-derived.**
   - Transcript rows are open entries.
   - The feed type erases at the kit port and casts back (`ChatPort.ts:35`).
   - The kit synthesizes run-end, finalizes interrupted parts, judges tool state by string prefixes and an operation refusal by output shape.
   - The live tail projects from `AgentMessage` whole on every chunk and reconciles with durable entries by heuristics.
   - Downstream, the visible feed and timeline scan and copy history on every change.

**Parts.** Four child specs with their own areas; dependencies between them are in "Order":
- [[16997c14]] — kit: thread session and pre-birth thread, turn commands, entry-view registry, feed regions, composer contributions, producer-driven thread modes.
- [[d68e71ff]] — the app's thread view: thread tier as the sole authority over thread life, thread services, slot, birth, feature contributions, surface adapters, scale list, pages.
- [[30b488ab]] — shell: section registry, columns and panels with their own geometry, `ShellOps`, one "slot → thread" writer.
- [[33589ccf]] — the server `threads.presence` feed.

**Shared contract with agent-audit.** The runtime→chat event model is set once — in [[c3436715|the runtime→chat event model]] (producer root — [[6433136a|the agent-side refactoring]]; `RunStatus` — [[9f3bb3f9]], run ends — [[7e9130bd]]): its owner is the producer. Only the consumer side is described here. Agreed:
- the entry union decodes on input; validation closes over the set kinds; each product kind's schema sits with its server module; the "kind → payload" link stays in the wire type;
- an unknown kind is a typed decode error on input plus diagnostics;
- a data-part registry;
- `ThreadToolState` is a closed union with one settlement projector; a settled call's outcome is `done` or `refused` with a refusal code;
- one resume cursor `feedPosition`: snapshot and every delta carry it; a gap beyond the producer window or a byte-budget overflow answers with a snapshot;
- exactly one run-end per terminal run that wrote entries; settlement first closes all open parts;
- withdraw removes the run's entries without run-end, the `withdrawn` outcome reads from `RunStatus.ending`;
- the live tail is entry deltas with stable ids, the client never receives `AgentMessage` chunks;
- run state is `RunStatus`;
- every turn command carries the client's input key; the producer writes a receipt (accepted said/queued/steered or refused with a code), a resend with the same key is idempotent, receipts of input-awaiting commands ride the snapshot and `RunStatus` ([[9f3bb3f9]]);
- `threads.presence` is this spec's feed, a pure projection of `RunStatus` and open-entry deltas.

The equivalence test splits in two halves:
- the producer proves the recorder's deltas after folding equal the kept rows;
- this spec proves a session that received the published events equals a session that received an independent durable snapshot at the same position.

**Affected modules (dependents).**
- [[cb732496|Chat]] — the kit itself.
- The app's thread view — `features/threads`, `features/pages`, `lib/wire`, plus the thread-tier services in `features/checkout` and `features/threads/native` moving to slot holding. No #module card; its rules sit under "Dump"; [[d68e71ff]] writes the card.
- The app shell — `lib/app/panes`, `lib/shared/panes`, `lib/shared/reading/Panes.svelte.ts`, `lib/app/chrome`, `lib/app/mobile`, `lib/features/workspace`; no card.
- [[1a45453a|Agent flows and sessions]] — the `threads.presence` feed and presence projector.
- [[627a3d25|The server live channel]] — the new socket feed.
- [[d1caad35|The agent module]] — the contract's producer, per [[6433136a]].

**Out of scope.**
- Plugin specifics — widget host, origins, bridge, permissions, a section with no route file of its own, any concrete plugin's design. That is the next spec, after the refactoring; only the shared seams here.
- Desktop windows ([[2f69b0c4|desktop window]]): `ShellOps` types the target, and a window joins as a new target with an adapter in the plugin spec.
- A session shared across windows: the shared object lives in one app window.
- The event model and its producers — [[c3436715]].

**Acceptance (end-to-end; children have their own).**
1. **A new feature is new files plus its declaration** — for the named contribution kinds: composer command, entry kind, tool renderer, mounting into a pinned region, section, panel kind. For the refactoring's acceptance, the test features of [[d68e71ff]] and [[30b488ab]] — which declare every kind and check its behavior without editing the slot, surface composition, `ChatSurface`, `ThreadSession` or the shell — suffice. The first real feature's diff after the refactoring is later evidence, not a condition. A new thread mode registers with the producer ([[bb429da3]]): the composer shows it with no kit or app edit. Behavior beyond these kinds may legitimately require a contract change.
2. **One session per thread.**
   - Any two holders of one thread (column, panel, a test holder standing in for a future widget) hold one thread scope, one `ThreadSession`, one subscription and one fold.
   - After the last holder closes, no subscriptions or timers remain.
   - Returning within the hold budget is resume with `feedPosition`; past the budget or on server refusal — snapshot.
   - Life tests are in [[eb9c2129]] and [[e5e1e307]].
3. **The live feed equals durable by construction.** Deltas and snapshot pass one projection. The equivalence test compares the store at one position after settlement, on the producer's corpus: interruption, withdraw, rewind/restore, reconnect, bounded bodies, operation refusal. Optimistic turns excluded.
4. **A content patch never pays for history.** The algorithm bench in CI holds the budget as median ratios on three axes — history, live parts, body length — on the "store → feed → timeline → row-model of the virtualizer" path: the large end of each axis costs at most twice the small.
5. **One owner per question.** The question-and-owner table is in [[eb9c2129]] (`FeedVerdicts`) and [[13bda205]] (`RowLife`). View verdicts derive once from runtime facts. Removed:
   - run-end synthesis;
   - interrupted-part finalization;
   - tool string predicates and output-shape refusal parsing;
   - entry-liveness derivation from its shape.

   Checked by code reading at acceptance and owner behavior tests, not by name-absence tests.
6. **Feed regions.** A pinned region outside the scroller and live rows hold their geometry, DOM and budget contracts through scroll, growth, resize, collapse and removal (tests in [[8d75d711]]).
7. **No closed lists in the shell.** `SURFACES`/`SEGMENT`, `Columns.of`, per-section visit fields, `PANE_KINDS` and `PaneName` are replaced by registries. Test section and panel open, are found by the route-manifest test and restore with no shell edit.
8. **File size.** In `packages/chat-ui` and `features/threads` no source file past 700 lines by the [[6b3210c7]] count. The `ChatTurns.svelte.ts` and `View.svelte.ts` debt entries leave, because the files split into subjects.

**Order.**
- The producer contract ([[c3436715]], finishing after [[7e9130bd]]) runs parallel to [[16997c14]]: port, session, `ThreadOpening` and turn commands never wait for it, while output removal, deltas, cursor and operation outcome do.
- Then [[d68e71ff]], then [[30b488ab]].
- [[33589ccf]] waits for the producer's `RunStatus` and entry deltas.
- The mode chip waits for the producer's mode registry ([[bb429da3]]).
- Client-side ACP-parse removal waits for the producer's normalized display ([[fb39e560]]).
- chat/terminal choice by `thread.harness` ([[e4e28eab]]) lands at any moment.
- Poker by text through tools (step 2 of the plugin idea) never waits for this spec.

**Work under the area.**
- [[2d5c76ec]] is absorbed by [[16997c14]]: its only debt is `ChatTurns.svelte.ts`.
- [[e239d4dc]] outlives this spec: its debt is wider than the thread view. The `View.svelte.ts` entry is closed by [[d68e71ff]].

**Decisions.** Technical decisions were made together with the chat-spec-astra reviewer on the merits. User-visible decisions follow what the user expects.
- **Effect everywhere.** Kit, thread-service, shell and presence contracts are Effect-native: `Context.Service` ports, feed `Stream`s, `Effect` commands with `Schema.TaggedError` refusals, `Scope` for life, `Schedule` for retries, `Clock` for time. Svelte is only the view layer. Pure transforms stay functions. The app's DI stays `@runlith/layer`, joined to Effect's `Scope` at one bridge point (as `wire/Live.ts:586-590`): moving the whole app composition to `Layer` is not chat's work.
- **Above-the-feed pinned** stays pinned on all the operator's devices: it is a server-side thread fact. Storage appears with the first pinnable contribution (plugin spec) — [[8d75d711]].
- **Thread mode** is one, from the producer registry ([[bb429da3]]), kept on the server per thread and identical on all devices. The session gives the declared modes as data, and the app's chip contribution switches them through `ThreadAuthority` ([[e1b8ac9f]]).
- **ACP threads behave like native**: the same typed entries, verdicts, receipts and surface. Only what the transport cannot do differs, and the thread itself declares that ([[e4e28eab]]).
- **Hold budgets:**
  - detached sessions — at most 8 and at most 32 MB of estimated weight per project connection; a session heavier than a quarter of the weight is never held; feed memory — 8 threads per slot ([[eb9c2129]]);
  - 4 live rows outside the window per surface ([[8d75d711]]).
- **Kit boundary.** `@runlith/chat-ui` stays a package. `@runlith/agent` is its platform; it will never go runtime-generic. The [[cb732496|Chat]] card rewrites: the assistant in the archive.
- **Order** — as above.
- **No 100-thread observer scenario** (operator, 2026-10-08): at most two threads on screen; many-threads load at once is not acceptance.

This spec leaves no questions for the operator. Widget origin and capability relaxation are decided together with plugin specifics.

**Coverage.**
- kit — [[16997c14]];
- app, including pages and thread-tier services — [[d68e71ff]];
- shell — [[30b488ab]];
- feed projection — [[33589ccf]];
- event model — `out`: [[c3436715]];
- plugins and desktop windows — `out`: the next spec.
