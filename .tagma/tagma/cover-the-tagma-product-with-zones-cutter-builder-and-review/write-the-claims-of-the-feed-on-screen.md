---
id: 01a0ca5e-4299-7963-8da4-58728f719454
title: Write the claims of the feed on screen
ord: 154
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Read `packages/chat-ui/src/ChatTranscript.svelte`, `TranscriptRow.svelte`, `TranscriptNotice.svelte`, `MessageNav.svelte`, `ActivityStep.svelte`, `ActivityStretch.svelte`, `Rail.svelte`, `RailRow.svelte`. Write the claims under [[3afb6b4f]]; the module is [[cb732496]].

This owner places rows and never decides how one looks. What is claimable: what the feed reserves beyond its last row, how a stretch's disclosure and hold work across a mounted window, and where the empty state is allowed to appear. The window itself is [[e8a94e5d]] and the reader's view state [[e9bd601b]] — both have tasks of their own.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. This is Svelte 5: load the `svelte5` skill first, so runes, snippets and attachments are read as what they are. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.