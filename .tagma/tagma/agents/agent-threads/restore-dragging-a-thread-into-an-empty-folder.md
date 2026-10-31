---
id: 01a191ca-8927-7c46-a85e-a7eb7446aa6e
title: Restore dragging a thread into an empty folder
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a191c9-09b4-7c8c-b1e6-d32f6788cfcb",
    "status": "done"
  }
---
Folder filing IDs inherited the thread-subject role, so invocation rejected a group-selected drag as place-mismatch before the shared folder owner could handle it. Filing now selects the list independently, resolves thread addresses through the existing team-address owner during preparation, and exposes an explicit project selector. Grouped filing, detach placement and a working thread dragged into a newly created empty folder pass, including persistence after reload and three shuffled orders. Independent review identified the lost team-name resolution and missing selector; both findings were reproduced and corrected. Final type, catalog-placement, signed-agent filing, detach, translation and Chromium checks pass; the changed HTTP regression passes all three shuffled orders.