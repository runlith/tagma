---
id: 01a191ca-8927-7c46-a85e-a7eb7446aa6e
title: Restore dragging a thread into an empty folder
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a191c9-09b4-7c8c-b1e6-d32f6788cfcb",
    "status": "in_work"
  }
---
Folder filing IDs inherited the thread-subject role, so invocation rejected a group-selected drag as place-mismatch before the shared folder owner could handle it. Mark filing IDs as values of the selected list. The HTTP regression failed on mixed member IDs before the fix; after it, grouped filing, detach placement and the browser drag of a working thread into a newly created empty folder pass, including persistence after reload. Finish after the required shuffled-file checks and independent review.