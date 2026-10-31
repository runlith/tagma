---
id: 01a1923e-4029-716e-bbcf-b9128c893a15
title: A desktop page nobody sees, drives or holds hides its view and rests
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19225-fc2d-7e38-badb-b8f369b669a5",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a1923e-2a3e-77f8-a9d1-e96cb02a2de0
---
Placement computes awake (visible panel, visible popup window, engine session, paint hold) and hides the view otherwise; the host tells Placement when a session drives the page. Electron contract test in `apps/tagma/desktop/src/browser/rest.itest.ts`.