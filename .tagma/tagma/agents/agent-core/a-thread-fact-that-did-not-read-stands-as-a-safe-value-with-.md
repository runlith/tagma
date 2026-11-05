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
A thread's authority, transport and capabilities have no absence, so a stored one this build cannot read stands as a safe value — authority as `review`, transport as `UNREAD_BINDING`, capabilities as `UNREAD_CAPABILITIES`, all none — and the reading (`readThreadFacts`, `readThreadTransport`, `readThreadBinding` in `persisted.ts`) sets `unread` beside the values, naming each fact that stands in. The mark rides the thread row, the list summary, the harness road and the session store's binding read, and the snapshot carries it on the wire. The key is absent when everything read: a frame holding an `undefined` optional key is dropped whole.

A stand-in only keeps the thread open and listed; a reader that acts decides by the mark, never by the stand-in's fields, since `UNREAD_BINDING` reads as a non-acp, non-terminal binding and `UNREAD_CAPABILITIES` as a transport that declares nothing:

- The transport registry takes the row, not the bare binding, and refuses a marked transport with `TransportUnread`, so a launch, release, rewind, answer or restart says the stored transport did not read. A release cannot know which transport holds a process, so archive and delete keep such a thread and project removal leaves it standing with a warning.
- `set_thread_transport` treats an unread transport as no road at all: it never answers `unchanged`, writes the asked road (the journal's transport entry names no `from`), and refuses `session-uncertain` while the thread holds a CLI process it cannot route a stop to.
- The CLI row names no road (`harnessTransportOf` answers `null`), and the app shows the transport as unread.
- `TransportCannot` built through `cannotOn` says the capabilities did not read and offers storing them again, instead of claiming the transport declares no such capability.
- A stored seat read back for a fork yields no kernel when its transport or capabilities did not read, so a stand-in is never written into another thread as a real value.

Capabilities do not gate a launch, so a native thread whose capabilities alone did not read still takes turns, with steer, withdraw, compaction and aside off; one whose transport did not read starts none. Text that is not JSON at all fails the row query before any reading runs.
