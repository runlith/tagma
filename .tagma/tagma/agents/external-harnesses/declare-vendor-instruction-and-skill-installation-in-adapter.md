---
id: 01a18e92-8173-7e3b-be17-8783c2e7f121
title: Declare vendor instruction and skill installation in adapter packages
ord: 203
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
Remove the remaining vendor-owned law and skill paths from the server installation machinery. Terminal declarations own instruction files, import recognition and independent skill aliases; project, user, home and selected-account installs update a canonical copy and link those aliases. The delivery review found that the account path still overwrote a user alias and ignored a custom location; the installation-owner regression reproduced a stale canonical skill before the fix, and now covers both the standard and custom paths plus isolated accounts. The HTTP status regression likewise reproduced an earlier installed alias being omitted before upgrade. Preserve existing project and user outcomes and prove them through the installation and status doors.