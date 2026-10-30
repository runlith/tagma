---
id: 01a18a48-fabc-746b-a2f7-6e93bddf534a
title: Expose the running developer installation's revision to graph readers
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-8536-738c-b5e1-63f0aaf778ff",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a116e0-5bba-787e-8220-cf400da4b4f7
---
Populate the existing graph reader provenance from a developer installation's recorded build revision when the server does not execute a checkout directly. Keep the reader identity tied to the installed code rather than the checkout's current HEAD, so check_rules can distinguish its builtin reader from the tree being judged without reloading code or restarting a server.