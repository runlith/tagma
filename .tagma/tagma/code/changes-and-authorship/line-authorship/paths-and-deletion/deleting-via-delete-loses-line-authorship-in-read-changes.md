---
id: 01a16df6-d914-76ea-b975-5a9ad80445dd
title: Deleting via delete loses line authorship in read_changes
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "delete answered \"2 removed\", but read_changes marked both entries withdrawn (reverted), and the deleted terminalAsks — nobody −111, written outside the record.",
    "command": "delete({args:[\"--\",\"/opt/workspaces/runlith/apps/tagma/server/src/composition/testing/threads/terminalAsks.itest.ts\",\"/opt/workspaces/runlith/apps/tagma/server/src/composition/testing/threads/terminalWidget.itest.ts\"]})",
    "expected": "Both deletions stay held by this session until submit_work, and read_changes shows it as the author."
  }
---
Filed from project `runlith`.

Session 01a16ded-9175-7310-be64-e74945295153. After the deletion only tests and reading git commands ran; git status still shows D for both files. read_changes of that path: deleted · nobody +0/−111 (written outside the record). The direct workaround is submit_work with explicit paths, since this session genuinely made the deletion tool call.
