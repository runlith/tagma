---
id: 01a1489c-3f8d-7afd-89e0-b8d384602e88
title: Desktop host reports apply strictly in their generation's seq order, and a break turns sent unanswered calls into an unknown outcome
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/connection.ts
  - kind: file
    ref: apps/tagma/server/src/desktop-browser/attachment.ts
  - kind: file
    ref: apps/tagma/server/src/desktop-browser/contract/wire/channel.ts
---
The channel is two-way but made of two roads: server commands travel over the live `attach_browser_host` tape, while host reports travel over a separate `REPORT_PATH` WebSocket, because the tape carries only server → client. Call answers, page events and CDP answers arrive in one stream, and order gives them meaning: an `navigate` answer overtaking a `changed` event would leave the page record at the old address. So every report carries a `seq`, and the embedder applies them strictly in order, holding early arrivals.

A `seq` gap is never refilled: the host keeps nothing sent, and a report lost inside one socket never arrives. Holding forever would pile memory behind a dead channel, so past the waiting bound the channel is declared broken and the host reconnects with a new generation.

A generation is one tape connection, and only the socket's own end ends it: the tape runs with no heartbeat (`heartbeat: false`, a hunk of the effect patch) and no open deadline. The server stands on the same machine, so its process ending closes the socket, while a server whose event loop stalls for seconds under load is alive; Effect's default pong deadline of five to ten seconds turned such a stall into a new generation and every call in flight into `outcome-unknown`. The report stream is taken once per generation, and a new tape of the same host ends the former generation: a late report of the old socket never reaches the new records. Everything promised to the old generation ends with it, the window's process declaration included: it is held under host and generation, and ending the generation ends it.

A call sent to the host with no answer before the generation ends finishes `HostLost` with `pending: true`: the host may have executed it (a click, a navigation), and the core answers `outcome-unknown` without retrying. A retry after reconnect would act twice. A call still queued, which the tape never picked up, never reached the host and ends `pending: false` — `host-away`. The live-page roll (`live`) returns the records to the host's truth: right after the answer the host re-reports every page's full state — history, hangs, open dialogs — because at the break the core dropped live state, and a quiet page never sends a new event on its own.

The host never piles reports the server does not read: past the unsent bound it closes the report socket, and the generation ends.

A large report (a PDF, an accessibility-tree snapshot) is cut into parts so every message stays under the server WebSocket message bound; parts of one report travel in a row and take one `seq`.
