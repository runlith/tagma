---
id: 01a1648e-67fd-74e6-a5f7-2fac75fe8d12
title: OpenCode runs the hosted turn in a private CLI, while execution and the journal stay with Tagma
ord: 1
tags: ["explanation"]
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/runner/opencode
---
The held runner keeps the official OpenCode separate from the Tagma server and uses the shared hosted kit: the plugin passes the callback into Relay with the source id, and an independent event stream seals the message before results return. Frozen system and catalog arrive over public RPC; the context hook excludes tools outside the catalog and returns media at the journal images' positions, because the files API carries attachments before text. The private host shares the account DB with other threads but never starts managed recovery. Continuation is accepted on the durable terminal Execution projection — the last idle message — and an empty inbox; process-local idle after a fresh launch proves nothing, while an unfinished conversation is restored by the existing Tagma journal road. The vendor session and credentials belong to the account; the plugin and the temporary configuration belong to the thread's scratch.
