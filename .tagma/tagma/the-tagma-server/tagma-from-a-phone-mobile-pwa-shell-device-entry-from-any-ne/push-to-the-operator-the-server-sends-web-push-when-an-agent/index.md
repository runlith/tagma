---
id: 01a10b84-a61c-7f1c-a4af-cae1c39abc78
title: "Push to the operator: the server sends Web Push when an agent waits, fails, or finishes"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/attention.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/attentionWindow.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/pendingAsk.ts
---
The phone in the pocket learns that an agent waits for an answer, has failed, or has finished, with no open app and no infrastructure of ours: the server itself sends Web Push through APNs and FCM. Local notifications out of the live socket, as at Orca, do not fit: the phone puts the backgrounded app to sleep.

## The source is `threads`

- `threads` publishes an "Attention" event source in its contract: a snapshot and changes of the full population. The feed window (`threads/list/attentionWindow.ts`) trims rows and sends a repeated `list` on resync — it does not fit push. The "what needs attention" rules are never repeated in another module.
- Every event carries `eventId` and `occurredAt`, produced by `threads`. For a question that is its id: native has `questionId` (`threads/list/pendingAsk.ts`), an external harness has `question.id` in the session, but the shared projection loses it — carry it through. For a finish — `runId` and kind. `occurredAt` never comes from the stream's `updatedAt`, which other actions move. Renaming yields no new event; a new question with the same text does.

## The `push` module

- A new server module `apps/tagma/server/src/push`, kind product; imports platform, remote, threads. It subscribes to the `threads` source once, regardless of connected clients, and to the revocation event at `remote`.
- The VAPID pair is a `push.key` file (0600) in the data directory, created once; an unreadable key is a visible push refusal, not a silent regeneration.
- Tables: `push_subscription` (id, deviceId, endpoint, p256dh, auth, createdAt) and `push_sent` (subscriptionId, threadId, eventId, sentAt) — only a sent mark, no on-disk queue. Endpoints and keys are secret address data, never printed into the journal.
- Sending is the `web-push` dependency behind the module's small adapter; it never lands in the browser bundle, working under Bun is checked first.
- Retries on offline, 429 and 5xx are in memory, bounded, honoring `Retry-After`, never blocking streams. Before a retry it checks that the event is still current for the stream and the subscription is alive: an old question never arrives after it was answered. 404 and 410 delete the subscription; 400, 401 and 403 are visible diagnostics, subscriptions stay untouched.
- `push_sent` marks live an hour and are deleted by age, not by the event leaving "Attention": archiving and restoring a stream return the same finish. On boot and after resync, whatever is still in "Attention", younger than the subscription, under an hour old and unmarked is sent in addition.
- Device revocation deletes its subscriptions and stops new sends to it.
- Operations: `read_push_status` (the VAPID public key, this device's subscription), `subscribe_push`, `unsubscribe_push` — only from a paired device. The subscription itself is "notifications on"; there is no global flag.

## Contents

`{title, body, url, tag, badge}`: title is "<project> · <thread title>"; body is the question's start, "Finished", or "Failed: <the short reason from attention, not the provider's raw error>"; url is `/<project>/chat/<id>`; `tag` = threadId; badge is the count of waiting and failed. The whole payload after JSON is at most 3 KB. RFC 8291 encryption closes it from APNs and FCM; showing on the locked screen is the phone's setting.

## Service worker

- `push` shows a notification for every push — otherwise iOS revokes the subscription (`userVisibleOnly`); only the server suppresses duplicates. `renotify: true`: a stream's new event replaces the previous notification with sound. `setAppBadge(badge)`. The payload suffices: the SW never calls the server, and the notification arrives even when Tailscale on the phone is off.
- Click: with a window — `postMessage(url)` and navigate inside the app; with no window — `openWindow(url)`.
- When the app opens, notifications whose streams are no longer among the waiting and failed close: the question may have been answered at the computer. An open stream closes its own notification by `tag`. On start the client reconciles `getSubscription()` with the server.

## Guarantee

Best-effort with duplicate suppression. What is marked in `push_sent` never repeats; a crash after the provider accepted but before the mark may yield one duplicate; an event that arose and vanished while the server was down is never delivered late. A notification the provider already accepted may still arrive after revocation.

## Acceptance

- A locked iPhone (a home-screen PWA, iOS 16.4+) and Android on a reachable network receive push about an agent's question; a tap opens the stream.
- A server restart, including handover to the successor, never repeats the marked; an event that stayed current arrives after the restart.
- A new subscription receives no avalanche of old events.
- No new push leaves for a revoked device.
