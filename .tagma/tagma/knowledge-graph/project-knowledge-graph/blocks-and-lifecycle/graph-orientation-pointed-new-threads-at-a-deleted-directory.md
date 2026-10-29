---
id: 01a13085-3f6f-70ae-a0e9-cc6e0c74b2c8
title: Graph orientation pointed new threads at a deleted directory
ord: 23
tags: ["reflection"]
fields:
  {
    "actual": "A thread born 2026-10-11 at 18:58Z got a stale product directory in its orientation and at once ran grep #11 and glob #12 on the missing directory. The git move a6370e619c happened at 14:26Z; the current runlith card already names apps/tagma, its graph log shows the later commit 086d5325 at 20:11Z.",
    "command": "read_thread_record {\"threadId\":\"01a12c54-577c-7c87-b786-66ba4ae3ca2e\",\"at\":[{\"at\":2}],\"fields\":[\"entry.text\"]}",
    "expected": "A new thread gets a graph orientation with the current product root, apps/tagma, after the checkout and sources move."
  }
---
Filed from project `runlith`.

The same stale orientation stood in thread [[01a12bcd-fa98-7c9a-a083-30b5c1197afd|the Opus researcher]]: #3 names the deleted directory, #40 and #45 refuse on it. The line's owner is [[4d2ff254|the runlith orientation]], delivery is [[ab05dfec|the native harness]]. No standing anchors under the deleted directory are found now; the observation concerns the text then delivered, not proof of a defect in the current resolver.
