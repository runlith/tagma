---
id: 01a15b87-fcde-7e5b-b880-a3de9e25ff6b
title: "The tool display projection takes the raw model input: an off-type value lands in the call entry's typed reference"
ord: 87
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b88-e400-7301-999d-e6107710b7d6",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/agent/src/agent/tool.ts
    symbol: toolPartialDisplay
---
`toolPartialDisplay` (`packages/agent/src/agent/tool.ts`) hands `display.project` the raw model-input fields, while projections are declared over the decoded input's `Partial`. On 20 October at 22:29:25 the model called an undisclosed `read_output` on ACP with `incarnation: "167"` as a string; `read_output.called` (`commandCatalog.ts`) put the string into `toolDisplay.reference.incarnation`, and the call entry stopped reading by its schema: the ACP driver step failed (`ThreadCallBroke … Expected number at ["toolDisplay"]["reference"]["incarnation"]`), and a live tail of the run with that entry dropped every `thread.subscribe` of the thread. Both roads stand on the raw input: hosted display (`ThreadHosting.display`, `ThreadHosting.ts:510`) and native input streaming (`turn/call.ts:158`). Do: the projection takes only fields that decode under their field's schema; the rest never reach it. Prove it with a public-contract test of `toolPartialDisplay`.
