---
id: 01a118f1-5f59-7eb8-856a-a0e2e1b8ac9f
title: ChatSurface from owners and composer contributions; thread modes are producer session data
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatSurface.svelte
  - kind: file
    ref: packages/chat-ui/src/composer.ts
---
**Outcome.** `ChatSurface` assembles from owners, not from ~80 props (`ChatSurface.svelte:67-144`). Everything a thread feature adds to the composer it registers itself. The composer shows thread modes as the producer declared them: the client has no mode logic of its own.

**Surface contract.**

`ChatSurface` receives:
- `thread` — `ThreadOpening` or `ThreadSession` ([[eb9c2129]]);
- `turns` — the holder's `TurnCommands`;
- `kinds` — `EntryKinds`;
- `composer` — `ComposerContributions`;
- `memory` — the slot's feed memory;
- `rendering` — markdown/code/button/userText snippets, `copyText`, diff highlighting;
- `navigation` — the kit's own port: `openThread(id)` and `entryAddress(id)`. The app fills it; the kit knows no shell types;
- `preferences` — verbose, stretches, disclosure;
- `handle` — `PromptHandle`, for dictation and outside focus.

From `thread` and its `FeedVerdicts` ([[d1d3672b]]) the surface reads itself: phase, liveness, run stage, run start, queue, steers, `hasOlder`, context, notices and thread modes. The caller never assembles them.

Callbacks repeating turn commands (`onSend`, `onQueue`, `onStop`, `onAnswer`, `onUnqueue`, `loadOlder`, `onDraft`) go away: the surface calls `turns` and the draft.

Where current capabilities go:

| Capability | Where |
|---|---|
| `keyboard`, `focusKey` | slot: focus belongs to the view |
| `handle`, dictation | `PromptHandle` in the contract; dictation is an app chip contribution |
| `contextUsage`, `contextDetail` | arithmetic is the session's verdict; product detail is an app panel contribution |
| `runNotice`, `notice`, `composerMessage(+Action)` | turn notices are `FeedVerdicts`/`TurnCommands`; product bands are a contribution |
| `interludes` (recap) | an entry-kind contribution, mounted by index |
| `rewind` | an app contribution, open in `rendering` as a rollback port |
| `toolActions`, `toolStatus`, `toolOpen` | the tool descriptor in `EntryKinds` |
| `activityIdentity`, `activityFacts`, `messageMeta` | kind-descriptor contributions |
| `toolModelText` | the tool descriptor |
| `toolRefused` | goes away: the call outcome arrives from the producer |
| `starters`, `placeholder`, `emptyState*` | `ThreadOpening` params |
| `skills`, `mentions*`, `onAttachFiles`, `attachAccept` | composer contributions |
| `mode`, `onCycleMode` | thread modes are session data; the control is an app chip contribution (below) |

**Thread modes.**
- A thread has one active mode from one producer registry ([[bb429da3]]): `trust`, `review`, `bypass` and any future one, e.g. plan — registered there.
- The session receives the thread's declared modes (id, label, description) and the active mode with the feed and gives them as data.
- The mode control is an app chip contribution. It reads modes from the session, switches by cycling and calls `ThreadAuthority`, the owner of the mode-switch operation. The kit never knows this operation. The mode lives on the server per thread, so it is one on all the operator's devices.
- The client never moves the turn for a mode and never decides for the mode. A new mode appears in the composer with no kit or app edit.
- `ComposerMode` (`composer.ts:40-45`) and `onCycleMode` go away.

**`ComposerContributions` — one subject's registry: composer.**
- Entry kinds live in [[8d75d711]], shell sections and panels in [[30b488ab]].
- A contribution carries its own handlers; it receives no dependency bag ([[c2f04d22]]). A handler is an `Effect` with its own typed refusal.
- A repeated id is an assembly refusal naming both contributions.
- Registration returns a disposer.
- The contribution's description is one per app. A contribution closing over the slot's DOM (prompt, focus, panel) is created per slot at mounting.

Contribution kinds:
- **command** — id, title, description, argument fields, availability as data, `run(args)`. The slash menu builds from commands. The kit's own `verbose`/`stretches` register the same way, and name parsing (`ChatSurface.svelte:374-386`) goes away. This continues `ComposerSlashCommand`, which already has `onSubmit`/`onOpen` (`composer.ts:24-34`), not a second type.
- **chip** — leading or right position, snippet, order.
- **panel** — an openable composer panel with focus return.
- **mention provider** — prefix and option search.
- **attachment kind** — accepted types and intake.

**Composer regions.** `ComposerSlots` (`media`, `input`, `leading`, `rightActions`, `panel`) are replaced by regions the contributions fill. Composer behavior never changes: menu, keys, history, drafts.

**How to check (performer).**
- A registered command:
  - appears in the menu;
  - its availability follows data;
  - `run` receives arguments, and its result (notice or refusal) shows;
  - after the disposer it is gone.
- Modes:
  - a fake connection declares a fourth mode; it appears in the mode chip, and cycling switches to it through `ThreadAuthority`;
  - the active mode, changed on another client, arrives by feed.
- `verbose`/`stretches` work through registration.
- Two slots of one thread never share DOM-closing contributions.
