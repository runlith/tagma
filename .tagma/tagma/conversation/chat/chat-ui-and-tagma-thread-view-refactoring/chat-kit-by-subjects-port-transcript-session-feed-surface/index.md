---
id: 01a118f1-5f59-7eb8-856a-a0df16997c14
title: "Chat kit by subjects: port, transcript, session, feed, surface"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: packages/chat-ui/src
---
**Outcome.** `@runlith/chat-ui` splits by subjects into five floors, bottom up; imports go only down.

| Floor | What is in it |
|---|---|
| `wire/` | the typed connection port: feed events and commands with their results |
| `transcript/` | the chat entry `ChatEntry`, the `fromEntry` projection from the runtime entry, the changing entry store |
| `session/` | the existing thread's session, pre-birth thread opening, turn commands, feed verdicts |
| `feed/` | the entry-kind registry, visible feed, timeline |
| `view/` and `composer/` | the surface, the feed with regions and virtualizer, the composer with contributions |

The kit stays the threads' chat of `@runlith/agent`: the agent package is its platform; the kit imports transcript and event types from there.

The kit does not own:
- widget hosting;
- operations, permissions;
- words and storage;
- the server connection;
- shell navigation.

All of it arrives through ports and contributions the app fills.

**Effect.**
- The kit's contracts are Effect-native. The connection port is a `Context.Service` with a feed `Stream` and `Effect` commands. Session life, attach and `PendingTurns` are `Scope` and fibers. Waits are `Effect.timeoutOrElse` and `Schedule`. Failures are their owners' `Schema.TaggedError`s. Time is `Clock`.
- No Promise members and no `AbortSignal` in the kit's contracts.
- Svelte stays the view layer. Components, `$state` and `$derived` read the owners' fields, which their fibers write. The kit holds no runtime of its own: the holder gives the runner that starts `Effect`.
- Pure transforms (`fromEntry`, visible feed, timeline) are ordinary functions, never wrapped in `Effect`.

**Why so.**
- `ChatTurns.svelte.ts` (658 lines without imports, the [[6b3210c7]] debt) holds the phase machine, snapshot and live-feed intake, turn commands, run identity and clocks, and its instance retargets between threads.
- `ChatSurface.svelte` takes ~80 props and parses the `verbose`/`stretches` slash commands by names itself.

The subjects cut gives every future holder a place: a widget holds a session with no surface, a plugin registers an entry kind with no kit edit, a new producer mode appears in the composer on its own.

**Parts.**
- [[eb9c2129]] — port, entry store, `ThreadSession` and its life, pre-birth opening, `TurnCommands`, `FeedVerdicts`. Repeated runtime-fact derivations go away.
- [[8d75d711]] — entry-kind and tool-renderer registry; changes as patch and splice through all floors; cost bench; feed regions; view-held feed memory.
- [[e1b8ac9f]] — the `ChatSurface` contract and `ComposerContributions`: commands, chips, panels, mention providers, attachment kinds; thread modes are session data.

**Kit acceptance.**
- In `packages/chat-ui` no source file past 650 lines by the [[6b3210c7]] count.
- The `ChatTurns.svelte.ts` debt entry leaves.
- The [[cb732496|Chat]] card rewrites from code: floors in `order`, entries, consumer.
- The [[1dd0be7a]], [[d1d3672b]], [[6412bd95]], [[6d2dde6c]] card rules re-read against the new design: sources point at new files, wordings hold.
- `ChatTurns`/`ChatTransport`/`ChatFold`/virtualizer tests move to the new owners. A test that pinned a removed mechanism (anchor heuristics, run-end synthesis) leaves. Its user-visible scenario (entry order, interruption, repeat) stays as an owner test or joins the equivalence corpus.
