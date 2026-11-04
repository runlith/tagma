---
id: 01a18452-e33b-7115-849c-cb5b114b448e
title: Frame attachment without renderer CPU attribution waits for facts and remains cancellable
ord: 10
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1a76a-aaa8-7eed-9b33-f9a8e85431e9
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/contract/service/pages.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/automation.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
  - kind: file
    ref: apps/tagma/server/src/browser/pages.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/targets.ts
---
Other-process frames have their own renderer queues, so a main-frame reply proves nothing about them. Their probes start before adoption, but without exact renderer CPU attribution silence supports no hang verdict: attachment and queued work wait for their own answer or session end and remain cancellable. A known main-renderer failure exempts recovery only when known at entry. The managed host does not force a renderer crash from elapsed silence or from other targets answering probes; neither fact proves which renderer owns the silent target. A persistently busy managed renderer recovers when its profile browser ends, or work moves to another profile, because reopening a same-site target can reuse that renderer.
