---
id: 01a123b1-a094-72bd-b4ab-f762e0d0c77f
title: "Plugins, stage 3: the tagma/speech bridge over the existing speech feeds"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a123b1-e4f9-7e27-8532-972bdf861a7e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/viewSpeech.test.ts
---
The spec's “Contribution points by stage” section → “Speech”: a `tagma/speech` extension bridge over the existing speech feeds (`speech/contract/wire/feeds.ts`, `callers: 'any'`), so a plugin's view (a language trainer) receives recognition and synthesis with no STT of its own. Connects to the plugin host through `ViewHost.methods`; a foreign MCP App does not receive it.

Done when a test plugin view receives speech transcript and voices text through the bridge, and dropping the view drops the speech subscription; on desktop and web.

`tagma/speech` delivered through the plugin host's methods; the contract is explained by the [[ace6da34|speech bridge note]]. App typecheck and 21 targeted bridge, lifecycle, and live-channel tests verified, including tail reading, teardown, mount isolation, and interrupting a one-shot feed on renew. One Sol xhigh round found a renew defect; the fix sits with `LiveConnection`. A real microphone, the `mic: caller` branch, and audible voicing in browser and desktop unverified. Synthesis plays on the server machine: voicing the synthesis audio on the view's device needs a separate contract for delivering synthesis sound to the client and playing it there.
