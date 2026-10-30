---
id: 01a16458-c462-7849-98a0-7c6114227879
title: The hosted kit holds the ACP session, turn opening, and tool execution; the vendor cycle plugs in through a neutral port
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a10973-ef85-739e-8a04-c139d0810682
  - kind: relates
    to: 01a16434-fc60-7079-91d8-189d050e0330
sources:
  - kind: dir
    ref: packages/hosted-runner/src
---
The hosted kit holds an ACP session, a turn opening, and tool execution; the vendor cycle plugs in through a neutral port.

The `Cycle` port separates the way the model is driven from the hosted protocol: the adapter owns the session-origin check and the moment it is replaced; on its signal the kit closes the old one, never admitting a busy session to replacement. A turn opening takes context and the directory before the first send; a cancel on that boundary never hands words to the model, and early steers wait for the prompt send. A handed tool stays with hosting when the server answer is unknown; a known refusal removes the execution evidence, and a partial input update never spends it. The message boundary names only calls the adapter has already announced, and the kit serves it at once: the journal links calls to results by it, while a boundary with an unannounced call is a visible driver refusal, not a wait that would have held every later turn's boundary. The relay hands the call's result to the vendor cycle only after every word the server answer named stands in that cycle's queue; only the adapter can wait for that, so the wait is its `queued` port, and an adapter with no words mid-turn never waits: the server names it no words. The new-session journal keeps text and image-byte order; the adapter picks how to hand it to the model, as it picks steer confirmation, cumulative spend, and its session's capabilities. The driver and runner dictionary is the kit's `wire/`, which the server's driver imports too; the kit never imports an SDK or a vendor runner, and the server fills its door port (`ServerDoor`).
