---
id: 01a1924a-42f8-7316-afe6-833f42ff4b1d
title: Desktop main declares its processes and the documents each renderer hosts over its local channel
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1924b-d758-7283-b8ce-1fd624316fc0",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a19236-e2ce-7b34-8015-7c0e70df78a3
sources:
  - kind: dir
    ref: apps/tagma/desktop/src
  - kind: dir
    ref: apps/tagma/server/src/desktop-browser
---
Step 2 of the spec, window side: desktop main collects its Electron processes, the webContents and frames each renderer hosts, re-declares on change and sends it over the channel the browser host attaches; the server's desktop channel fills the window-declarations port of `executions/load`. It measures Electron's creation-time precision against the kernel start on macOS and drops `TAGMA_DESKTOP_PID`.