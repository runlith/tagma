---
id: 01a118f1-5f59-7eb8-856a-a0e5e4e28eab
title: Thread-feature contributions gather from declarations, Conversation only composes, surface chosen by the thread's transport
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/external/Surface.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/Conversation.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/feedRecords.ts
---
**Outcome.** A thread feature declares its contributions in its own file, and the app's composition gathers them. For the contribution kinds this spec names, a new feature is new files plus its declaration, with no edits to the slot, surface composition or kit. Chat or terminal picks the adapter by the thread's own transport, not the list row.

**Declarations.**
- Each feature declares contributions in a declaration file. Composition gathers them with a glob on the `declaredActions.ts` pattern, which already gathers palette commands so. No central list ([[edea5454]]).
- Each declaration kind goes through its own assembler into its own registry. No single "everything about the feature" bag exists.

| Declaration kind | Registry |
|---|---|
| commands, chips, panels, mention providers, attachment kinds | `ComposerContributions` ([[e1b8ac9f]]) |
| product entry kinds, tool renderers | `EntryKinds` ([[8d75d711]]) |
| mountings into the pinned region | the surface region |
| sections, panel kinds | the [[30b488ab]] registries |

Contribution life:
- **Description** — one per app, assembled at load. The spec introduces no hot loading; registration has a disposer.
- **Instance** is created per slot at mounting, when the contribution closes over the slot's DOM (prompt, focus, panel, dictation), or per thread, when it needs the thread's service.
- A contribution shown on a thread receives that thread's thread scope and takes its service there ([[e5e1e307]]). It receives no foreign services.

What moves into declarations:

| What | From where |
|---|---|
| slash catalog and name dispatcher | `View.svelte.ts:555-654,806-829` |
| product entry kinds | `feedRecords.ts`, `Conversation.svelte:457-465` |
| tool renderers | `Conversation.svelte:301-304` |
| `toolModelText` | `Conversation.svelte:582-591` |
| model, delegation, recap, worktree, transport, skills, compaction, calls, dictation | each feature's own declaration |

Thread modes are never declared in the app: the producer registers them ([[bb429da3]]), and the composer shows them from the session ([[e1b8ac9f]]).

**ACP threads are like native.** The hosted road writes tool calls with the same typed entries as native: name, display, `ThreadToolState`, one projector's outcome. The server adapter (module [[287a4906]]) translates raw ACP forms before ingress ([[fb39e560]]). So removed:
- the tool renderer's ACP-sniff (`Conversation.svelte:360-367`);
- raw-form parsing and client-side diff computation (`external/acpCall.ts:30-55`). Removal waits for the producer's normalized display ([[fb39e560]]), which keeps everything the client shows now: diffs, text, file places, terminal links.

An ACP thread shows the same chat surface with the same renderers, contributions and verdicts as native. Only what its transport cannot do differs. The thread itself declares such capabilities (snapshot), and the surface hides them by that declaration, not by a variant branch.

**`Conversation.svelte` is composition only.** It binds slot, thread scope, registries and `ChatSurface`. Leaving it:
- preference storage (`:255-273,612-623`) — to the `ChatPreferences` owner;
- thread-name queries via `JSON.parse(facts.aims)` (`:156-179`) — to the `ThreadNames` port (`shared/threads/Names.svelte.ts`) with an address where a project exists. Other projects' thread names keep resolving: `Words.svelte.ts` now knows only its own project (`:24-28,52-54`), and its resolver becomes project-addressable;
- domain effects — skills update, compaction options, rewinds, dictation (`:93-108,151,153,236-253`) — to those features' services.

**Surface adapters.**
- `chat` and `terminal` are adapters behind one thread-surface contract. `chat` shows both native and ACP threads. `terminal` is only threads on the terminal transport, where the CLI output is the screen, not the entries.
- The adapter is chosen by the thread's transport, not the list row (`external/Surface.svelte.ts:14-15,45-46`). The snapshot already carries `thread.harness` (`server/src/threads/contract/wire/snapshot.ts:70-79`), so this part can land first.
- Variant branches in `Conversation.svelte:530-539` and `View.svelte.ts` go away ([[6f758080]]).

**How to check (performer).**
- A test feature, declared only in its own declaration file, adds four contributions:
  - a command: appears, runs, its result shows, vanishes after the disposer;
  - an entry kind with a renderer;
  - a tool renderer;
  - a mounting into the pinned region.

  Slot, composition and kit unedited in the process.
- A terminal thread opened by URL outside the list window opens as a terminal.
- An ACP thread and a native thread with identical entries (tool call, operation refusal, interrupted run) render identically.
- Two contributions with one id refuse at assembly and name both files.
- Another project's thread name in a composition entry resolves.
