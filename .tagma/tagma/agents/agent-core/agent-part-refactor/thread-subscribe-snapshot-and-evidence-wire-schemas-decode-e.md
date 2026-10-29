---
id: 01a11b53-c764-722c-bad6-cc75521d8256
title: Thread.subscribe, snapshot, and evidence wire schemas decode entries closed by the browser-installed kinds
ord: 32
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-9123ae16171c
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd5c3436715
---
[[ae16171c]] remainder: on the server entries already decode closed, while the `thread.subscribe`, snapshot, and evidence wire schemas still take the open `threadTranscriptEntrySchema`.

Do:
- the app boots module kinds into the kit registry (`packages/chat-ui` `EntryKinds`), and the same registry gives the wire schemas their closed union;
- an unknown kind answers with a typed decode refusal, with no passthrough;
- the open `threadTranscriptEntrySchema` goes away.

Proof: `feedPairs` decode in the browser path with the closed union, and an entry of an uninstalled kind gets a typed refusal.
