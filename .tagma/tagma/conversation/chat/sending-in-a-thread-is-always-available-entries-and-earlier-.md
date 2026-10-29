---
id: 01a12cb2-2d1a-748b-8670-c65c166cd559
title: "Sending in a thread is always available: entries and earlier sends order it, never block it"
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c8d-2157-745f-850a-5d81e92c5893",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThreadWrites.ts
  - kind: file
    ref: packages/chat-ui/src/session/TurnCommands.svelte.ts
---
In an idle thread no message could be sent: the button and Enter were off with no visible reason.

**Cause.** `TurnCommands.canSend` summed bans: a command in flight (`busy`, one per slot), the slot's `blocked()` (a settings, mode, recap or type-launch write) and "the feed holds an open question". Recap played no part in the observed case: `threads.recap` is off in the project. Most likely (inference; client state was not captured), the last ban fired: `ChatFold.openQuestion` was a `$derived` that froze when leaving the thread (task a800e9c4), and in a thread where the question was open at the moment of leaving, it stayed "open" after the answer. The server accepts a message in any thread state, so none of these bans is needed.

**Done.** Sending depends only on whether there is anything to send:
- `canSend` is a non-empty draft; neither recap, nor an open question, nor another command switches it off.
- Sends of one conversation go in press order: each waits for the previous one's delivery. A send from an unborn thread, pressed during birth, leaves into the thread the first one gave birth to.
- Settings, mode, delegation and approver writes started before the press order the send (`ThreadWrites.settled`), not block it.

**Check.** chat-ui tests: a send waits for a started write, a second send with opening leaves into the born thread after the first, an open approval does not hinder sending. Slot test: a send during settings writes leaves after all of them. Typecheck of chat-ui and the app.
