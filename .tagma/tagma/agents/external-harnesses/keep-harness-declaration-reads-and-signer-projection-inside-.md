---
id: 01a18e92-7f93-7c12-a473-341b1077d7d8
title: Keep harness declaration reads and signer projection inside their owners
ord: 202
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e90-ac7d-7af0-889b-2022d8e965b5",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
---
Move MCP row resolution out of composition and derive provider sources, harness loaders, hosted runners and CLI signers from one builtin package entry, so removing that entry removes all its paths. The hook keeps the package's lightweight session declaration beside its lazy provider loader: in an alternating source-run comparison on one machine, five hooks per lane gave full-declaration signers 238.23/258.33 ms p50/p95 and lightweight signers 197.22/257.79 ms; the builtin-package and installed-package lanes were 188.26/200.06 and 211.27/314.81 ms. The ingress benchmark used 12 door posts and three in-process and post-tool hooks, finished inside 30 seconds, and the full-declaration prototype lived only in scratch. These samples do not measure release bundles or other machines. Check the affected installation and hook doors.