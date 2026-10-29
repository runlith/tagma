---
id: 01a0d007-1990-76c4-a3c6-b71f65164438
title: "Carry requested compaction to the socket, the CLI and the app: `at` on thread.compact, tagma compact --at, /compact while busy with the steer and queue gestures"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d066-d8c5-7d04-8647-f453abaf6d7e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d007-194a-7976-97d6-11296ad506f4
  - kind: waits-on
    to: 01a0d007-1987-7572-9661-898cd2a7785c
---
Carry the verb [[d2a7785c]] answers to every human door of [[6ad506f4]] (§10): `ThreadActs.compact`, the socket's `thread.compact` schema and answer (`socket/rpc.ts`, `socket/threadChannel.ts`), `tagma compact --at` (`cli/commands/harness.ts`), and the app — `/compact` offered while busy in `HarnessHost.svelte.ts`, the steer gesture sending `step` and the queue gesture `end`, the pending request shown among steers or queued rows with its take-back.

Done when acceptance criterion 11 holds, the socket road is proved by a live test, and the claims over these doors are written from the code. Other sessions are writing `socket/` and `harness/protocol.ts`; read `read_changes` on those paths before editing them.
