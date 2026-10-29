---
id: 01a12699-1673-714b-a6a5-79ebd801f443
title: Clients show the restart window and return the person to the same thread
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Live.ts
  - kind: file
    ref: packages/chat-ui/src/session/PendingTurns.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
---
In the restart window the person sees that Tagma is restarting and how long it takes, and stands in the same thread with the same draft afterwards. The feed opens at the end, as on an ordinary thread open: the place in the feed is neither kept nor restored.

## What the person sees

1. The update is ready — the surface gets a "server is restarting" event over the live channel before the channel breaks.
2. The page stays in place. Over it — the restart state: what is happening and how many seconds have passed; for an announced long update — the step from the start state. The already loaded feed reads on, the draft edits.
3. The server is ready — the channel reconnects, the feeds resubscribe. If the client build changed, the page reloads once and opens the same thread.
4. A failure is visible as soon as it happened, and only then: the verdict is passed by fact, not by an expired deadline — the person's machine can restart for minutes. The desktop window sees the process and the data catalog and names the phase and cause of a failed start or restart; the browser tab and the bound device show how long the silence lasts, the last known phase, and the recorded failure ([[6417e7fa]]).

## What stands now and what is missing

| State | Now | Needed |
|---|---|---|
| Thread address | Page reload keeps the URL | — |
| Side panels, feed expansions | Kept (`app/panes/SidePanes.ts:265-305`) | — |
| Draft and attachments | Text, mentions and documents in local storage, files in IndexedDB asynchronously | — |
| Unconfirmed send | Lives in page memory and does not survive reload (`packages/chat-ui/src/session/PendingTurns.ts`) | — |
| Channel reconnect | Retry period up to 10 s (`app/src/lib/wire/Live.ts`) | — |
| `/health` polling | No per-attempt deadline (`app/src/lib/app/chrome/Standing.svelte.ts`) | — |
| Client build change | Two places start the reload independently | Reload after the server is ready |
| Window length | Not measured | The client remembers the window start so it survives reload, and after returning reports the length to the server — [[212d752c]] |
| Desktop window | On load failure goes to the root; knows no start phases | Phase and cause from the start state |
| `tagma` CLI | A call in the window fails with a transport failure; `/health` probe with no deadline (`cli/door.ts:40-85`) | Waiting verbs read the start state |
| Bound device | Binding survives restart; the remote door opens later than the local one | The remote door does not wait for history serving — [[9b246531]]; until it opens the device shows its own count |

## Rolled back on the operator's word

Task 3ce4493a built and landed keeping an unsent message across reload, the place in the feed, a single reload owner, a `/health` attempt deadline, frequent channel reconnect in the restart window, and the desktop window returning to the last address. The operator did not ask for any of this, and it was all rolled back in commit 87d010eae0. None of it is built again without his word.

One of the rolled-back items is tied to the window budget: with a retry period up to 10 s the client window can be seconds longer than the server interval. That is named here as a fact, not as a task.

## How it is arranged

- The client restart state is one, at the connection owner: a server event or a lost connection opens it, an open thread and an accepted act close it. Reconnect frequency, display, the moment of the single reload, and the measured window length depend on it.
- No shared retry of unfinished operations is added: an unclear mutation must not be retried.
- A desktop shell change (main, preload, native helper) takes effect on the next application start; how that happens is decided by the installation spec.

## What the implementer proves

- A client whose server recorded a start or restart failure shows it with its cause; while the process is alive and holding the data catalog, the client waits and does not call it a failure.
- A browser check on one's own server instance: a restart with a client build change gives one reload and opens the same thread with the same draft and attachment; the window length the client reported stands in the restart record.
