---
id: 01a132c0-7e34-7d66-9e65-bd1a401edb9e
title: A started turn and a question answer live in the browser until the server answers, and the next page carries them through under the same key
ord: 45
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a132c0-3d5c-77d4-b807-e6ab793c6887
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/PendingStore.ts
  - kind: file
    ref: packages/chat-ui/src/ChatFold.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/session/PendingTurns.ts
---
The composer clears at press time, so until the server answers the turn is held by two entries: a `PendingShelf` entry (one `tagma.outbox` IndexedDB row per turn) and the whole draft set aside by `ChatDraft.setAside` in the `DraftShelf` under the `outbox:<inputId>` key — with pictures and files no text can bring back. `PendingTurns` writes the entry at `begin`, updates at `bind` and on handoff (`sent`), and erases when the turn ends: accepted, refused or forgotten; the set-aside draft leaves with the entry. A word raised from the queue into the next step has no local files: its attachments already lie on the server, so the entry carries their addresses (`stored`), and returning by it after a reload downloads them into the draft with the same `DraftShelf.takeBack` as "Edit".

The entry belongs to the page that wrote it: the page holds its holder's Web Lock while alive. The next page takes only entries of pages whose lock is free, and takes each under the turn's lock, rewriting the holder to itself — a live neighbouring tab never loses its turns, and exactly one page takes an orphaned turn. Without Web Locks, others' entries would count as orphaned.

A handed turn goes as unconfirmed and resends with the same `key`: the server keeps entry keys as testimony and answers a repeat, while a repeat arriving while the first call is still running waits for its answer (`ThreadAdmission`), so a second turn never happens. An unhanded turn returns to its draft whole, in press order, and never leaves on its own: before handoff the attachments are not uploaded yet.

A call the server never answered within `ANSWER_MS` is neither cut nor repeated alongside: the turn becomes unconfirmed, the press ends, and the turn is decided by that same call's answer or a receipt in the feed.

An agent-question answer is the same deliverable act, not an optimistic mark: `PendingTurns.answer` writes the entry under the answer key before the call (no draft — nothing to return to the field) and runs it through the same `ANSWER_MS` wait, resends and next-page pickup. All answer delivery runs in the `PendingTurns` scope, not in the press fiber: a closed thread panel interrupts the press but not the delivery. The server knows a repeat by key and answers with the previous result (`Questions.keyedAnswer`). The entry erases when the server answered or refused, or when the feed showed the question already settled — by answer, expiry or withdrawal (`ChatFold.settledAnswers` → `PendingTurns.concluded`), even while the first call is still in flight. Until the answer is confirmed, `ChatFold` keeps a `sending` mark on the question and reapplies it onto every feed snapshot while the server still asks: the card writes that the answer is being sent, not read as answered, and the server's entry beats the mark. Without this, the "answered" mark, which only a refusal removes, stays on the card after a lost or interrupted call, and the agent waits for the question to expire.

An IndexedDB failure only writes to the console: sending goes as without entry, and such a turn never survives a reload.
