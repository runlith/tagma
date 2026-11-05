---
id: 01a1ad6e-b0c9-701b-bbc0-b90da4a61a64
title: A thread fact that did not read stands as a safe value with an `unread` mark, and readers act on the mark, never on the stand-in
ord: 212
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15208-9958-790e-b6dd-4de6a15337e5
sources:
  - kind: symbol
    ref: packages/agent/src/thread/record.ts
    symbol: UnreadMark
  - kind: symbol
    ref: packages/agent/src/thread/persisted.ts
    symbol: readThreadFacts
  - kind: file
    ref: packages/agent/src/thread/transport/Transports.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/switch.ts
---
A thread's authority, transport and capabilities have no absence, so a stored one this build cannot read stands as a safe value — authority as `review`, transport as `UNREAD_BINDING`, capabilities as `UNREAD_CAPABILITIES`, all none — and the reading (`readThreadFacts`, `readThreadTransport`, `readThreadBinding`, `readThreadCapabilities` in `persisted.ts`) sets `unread` beside the values, naming each fact that stands in. The mark rides the thread row, the list summary, the harness road and the session store's binding and capabilities reads, and the snapshot and the CLI row carry it on the wire. The key is absent when everything read: a frame holding an `undefined` optional key is dropped whole.

A stand-in only keeps the thread open and listed; a reader that acts decides by the mark, never by the stand-in's fields, since `UNREAD_BINDING` reads as a non-acp, non-terminal binding and `UNREAD_CAPABILITIES` as a transport that declares nothing:

- The transport registry takes the row, not the bare binding, and refuses a marked transport with `TransportUnread`. A launch ends refused with that reason; a release, rewind, restore, answer or restart answers `transport-cannot` at its door; taking back a steer answers `withdraw-failed`, since whether the word was handed is unknown.
- A release cannot know which transport holds a process, so archive and delete release only the threads that hold a run or a live session: an idle thread whose transport did not read is archived or deleted, and one holding a process is refused rather than claimed ended.
- `set_thread_transport` never answers `unchanged` for a road whose transport or capabilities did not read: it writes the asked road with fresh capabilities, journaling the road it knew (none when the transport did not read; the same road for a capabilities-only repair, which the app shows as restored), and refuses `session-uncertain` while the thread holds a CLI process it cannot route a stop to.
- The CLI row names no road (`harnessTransportOf` answers `null`) and carries the mark, so the app shows the transport as unread instead of the stand-in's capabilities.
- `TransportCannot` built through `cannotOn` says the capabilities did not read and names the stand-in transport `unread`; a native thread is offered a new thread, a harness thread `set_thread_transport` as well.
- A model move on a thread whose capabilities or transport did not read refuses `model-pinned` saying so, never "fixed at its birth".
- A stored seat read back for a fork yields no kernel when its transport or capabilities did not read, so those stand-ins are never written into another thread. An authority stand-in is inherited by a fork or spawn as a real `review`, the conservative direction.

Capabilities do not gate a launch, so a native thread whose capabilities alone did not read still takes turns, with steer, withdraw, compaction, aside and model moves off; one whose transport did not read starts none. Text that is not JSON at all fails the row query before any reading runs.
