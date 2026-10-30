---
id: 01a18d5f-6ff2-76f6-a95c-553c3a4752ab
title: "Devin moves into packages/adapter-devin: terminal surface, vendor-run ACP profile with launch-time proves check, metadata reader"
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188ae-2d0b-74f2-91fc-f0e9ba085af5",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: waits-on
    to: 01a18d5f-4464-7fa5-a9a3-ccd6ff96ef8c
---
Step 6 of the Migration in [[57787448]], one landing; the spec's acceptance 5 (a vendor-run profile claiming a capability its agent does not negotiate refuses at launch) lands here. Server code under `external-harnesses/vendors/devin` is deleted, tests move and stay green, behaviour and ids are unchanged.