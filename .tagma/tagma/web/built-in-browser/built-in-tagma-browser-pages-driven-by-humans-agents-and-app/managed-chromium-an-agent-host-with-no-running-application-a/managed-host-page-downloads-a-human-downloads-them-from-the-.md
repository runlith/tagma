---
id: 01a148b4-454d-7d1e-8a7c-5f3e417e87d0
title: "Managed-host page downloads: a human downloads them from the panel and the phone, an iframe download lands in the record"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a147d6-7ef4-7c9c-9e39-feae8df087e4
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a10eb1e2301
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/Downloads.svelte
  - kind: file
    ref: apps/tagma/server/src/managed-browser/host.ts
---
The server writes a windowless page's downloads into its record, an agent reads `read_page_downloads`, but a human on the web or the phone cannot get the file: the `browser.pages` feed carries no downloads, there is no file-serving route, and the page screen does not show them. The spec requires a human to download them from the panel.

Second: `Browser.downloadWillBegin` assigns a download to a page by `frameId`, while the host looks only among tab targets, so a download on a link inside an iframe never lands in the record, although Chromium writes the file.

Done when a page download can be fetched from the panel and from the phone page screen, and an iframe download appears in the page record — a system test on a managed host.
