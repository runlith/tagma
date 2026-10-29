---
id: 01a15eeb-6b48-7ca8-9c93-24d9511b80d7
title: "Client: Esc belongs to the thread, a stop has a state, a press has a visible outcome"
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118f1-5f59-7eb8-856a-a0deb7bb8a8f
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/threads
  - kind: dir
    ref: packages/chat-ui/src
---
In the client Esc belongs to the thread, not the input field. A stop has a visible state, every press a visible outcome.

## What stands

- **Esc is caught only by the composer textarea** (`PromptField.svelte`, `Composer.svelte:281-356`). With focus in the feed, on the "Next step" line, on an image preview, or on the Stop button, the press goes nowhere. The "esc · stop and send now" hint (`PendingInputDock.svelte`) is text without a handler.
- **A stop depends on feed reading.** It is allowed only while `running = verdict.alive` (`ChatSurface.svelte:72,438`), and `alive` needs a live feed read (`FeedVerdicts.ts`). On reconnect Esc becomes `rewind-arm`, and a second Esc within 600 ms opens rollback selection.
- **Interceptors before the stop:** history viewing, `/` and `@` menus, rollback selection, dictation, an open layer (`composerKeys.ts:50-77`, `speech/dictation/Keys.svelte`, `dismissal.ts`). Each place has its own order.
- **Goal and answer.** The stop goal is the `activeRunId` from the last frame (`TurnCommands.svelte.ts:363`); the `not-running` answer is thrown away (`:537-541`).
- **No "stopping" state and no repeat cutoff.** Two stops with `withdraw` race for one `PendingTurns.withdrawals` map entry, and words can vanish from the screen.
- **`withdraw` is decided by the client** from its own copy of `capabilities.history` (`:522`). On a stale copy the server refuses the whole stop.
- **`stopWhenRunStarts` is unreachable** from the interface (`:365-368, 554-572`).
- **A second stop implementation.** The menu and the thread-list preview stop their own way (`ThreadChats.stop`), with different feedback.
- **Command lifetimes differ.** A plain stop lives in the session scope and breaks when leaving the thread (`ThreadSession.owned`). A stop with `withdraw` lives in the `PendingTurns` scope.
- **Enter awaits others.**
  - It awaits `preceding()` — all slot-settings records, with no deadline — and the previous send's attachment upload (`TurnCommands.sendDraft`).
  - A word on a going turn is not drawn until the server frame (`bubble: false`).

## What will stand

- **Thread keys belong to the thread surface.** Esc works with any focus inside the thread, in one order:
  1. a layer, menu, or rollback selection is open — close it;
  2. else a turn is going (by session fact, not by feed reading) — stop it;
  3. else — rollback.

  The waiting-words hint and the Stop button draw from the same decision.
- **The thread session is the stop act's single owner** for chat, menu, and preview.
  - "Stopping…" stands from the press until the frame with the turn end; a repeated Esc in this state sends nothing.
  - Esc names the thread's "current turn", with no id from the feed.
  - The server answer is always visible: `stopped` — the frame will show the end; `requested` — "Stopping"; `nothing-running` — a short note; a refusal — a note with the cause.
- **A stop is available while the feed reconnects.** The command travels the command socket; when the socket is closed it awaits its opening and leaves first.
- **The client does not decide `withdraw`.** The server returns words to draft as one frame fact — `ending: withdrawn` together with the words. The `withdrawals` map leaves.
- **Thread commands (stop, send) live in the application scope**, not the view's.
- **Enter.**
  - The draft becomes the "Next step" line in the same frame.
  - Sending awaits no settings records it does not depend on, and no other sends' attachment uploads.
  - Send order is press order.
- **`stopWhenRunStarts`** and the second stop implementation are removed.

## Acceptance

Session and surface tests (Vitest, mounted graph):
- Esc with focus in the feed, on "Next step", and on the Stop button stops the turn.
- With a `lost` or `broken` feed Esc stops the turn instead of opening rollback.
- A repeated Esc at "Stopping…" sends no second command.
- `nothing-running` is shown.
- Leaving the thread does not break the stop.
- Enter during a hanging settings-record write leaves.
