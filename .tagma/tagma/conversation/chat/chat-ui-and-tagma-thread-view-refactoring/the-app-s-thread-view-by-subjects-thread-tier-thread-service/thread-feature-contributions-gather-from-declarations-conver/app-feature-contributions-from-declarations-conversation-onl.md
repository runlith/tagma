---
id: 01a11901-470f-7498-99ae-69edca82b61a
title: "App: feature contributions from declarations, Conversation only composes, ACP as native"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e5e4e28eab
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cd1fb39e560
  - kind: waits-on
    to: 01a11901-470f-7498-99ae-69ecdb527d85
  - kind: waits-on
    to: 01a11caa-42ff-703c-82f5-4128b0dc848c
---
Per [[e4e28eab]] except surface choice. Removing ACP parsing waits for the producer's normalized display ([[fb39e560]]).

Done: the test feature from [[e4e28eab]]; ACP and native render identically.
