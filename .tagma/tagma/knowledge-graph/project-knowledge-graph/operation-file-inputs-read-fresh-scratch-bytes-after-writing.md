---
id: 01a12c87-3dba-7604-92dd-70820db0e31b
title: Operation file inputs read fresh scratch bytes after writing
ord: 20
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4efd9c8236",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d0d5-44a0-7ab4-b2f7-b4e5e7d9f2d1
---
Check apply_batch after writing and editing scratch, file creation under new directories, and the link to edit_block cost; fix only a confirmed root cause at its owner.

On current code, creating new directories is already fixed by the [[8d9d2adc|write fix]], commits be27153a13, 3ec1e0a6c7, b792047112: preparation and admission get one physical address through the nearest existing ancestor. All 14 preparedSubjects integration tests passed. On a separate tagma:try build 5415a3bbb2-dirty 20261011T195435661Z a typed write created scratch ws/deeper/input.json; apply_batch refused on a bare array; a typed edit fixed the same file; the next apply_batch answered status=ok at once. The stale read did not reproduce in this sequential scenario; the three source reflections stay open. BatchFiles reads the Node FileSystem on every call, so no new cache fix follows from this sample; the historical cause is not established.

Four sequential edits of a new untagged block of 174098 characters on the same stand took 482, 307, 154, and 410 ms. Load around 15 concurrent agents and a long history were not modelled; a separate investigation covers edit_block — [[3751ed77|performance task]]. The stale-read check required no source change. Review found a separate creation-through-edit defect with an empty oldString: parent directories were not recorded before CAS. The fix is [[87fba72c|edit task]], commit bfb18cc7ae; the public edit test passes red/green, 15 preparedSubjects integration tests and agent-tools typecheck passed. The operator's server is untouched.
