---
id: 01a149c8-375a-7feb-a9de-77eda565e03a
title: "Closing a page bypasses beforeunload on both hosts: an unsaved document closes with no question"
ord: 4
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a147d6-7ef4-7c9c-9e39-feab93cb7437
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/host.ts
  - kind: symbol
    ref: apps/tagma/server/src/browser/pages.ts
    symbol: makePages
---
The [[255c4582|desktop host spec]] promises coordinated closing: a page with `beforeunload` stays open, the human or agent answers, and only consent closes. Neither host has this now: desktop closes `webContents.close()` with no `waitForBeforeUnload`, managed closes `Target.closeTarget`, and both destroy the page at once.

One host fix cannot solve it. The `PageHost.close` port answers with an empty reply, and `Pages.close` closes the record and forgets the page after the host's answer — even after `HostRefused`. A host that held the close would leave a live page with no record. What is needed is a contract shape: `close` answers when the page is closed, or refuses when the exit is declined, and the record stays on refusal. After that, hosts hold closing through the same `beforeunload` dialog as navigation. Done when a shared engine system scenario closes a page with `beforeunload` on both hosts: refusal leaves it open, consent closes.
