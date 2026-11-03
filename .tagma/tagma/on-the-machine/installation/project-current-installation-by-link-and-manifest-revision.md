---
id: 01a1a257-34d0-7068-8429-0c22bcbeecf9
title: Project current installation by link and manifest revision
ord: 65
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a18-7360-ba89-67591ec4329c",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
---
Succession now uses the closure owner's projection keyed by canonical target and manifest realpath, device, inode, size, modification and change timestamps. The succession.current regression failed on repeated installation.read proof spans, then passed concurrent-read deduplication, A→B→A reuse, same-size changes with preserved mtime, missing→present and a link switch during proof; projection.itest.ts passed seeds 1, 2 and 3. The synchronous read/at/identified owner API is handed to the desktop update-path owner; its caller adaptation remains part of this finding until landed.