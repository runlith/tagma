---
id: 01a0cf56-2ae6-7d0d-8f25-fcafce024255
title: "4a: move agents, interactive starts, stdin handles, the managed spawner and the capture instrument onto lanes, and retire control_terminal"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d0f4-6cac-7467-9993-fa8bfc40b9ff",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf56-2840-7e57-a738-3a9fafbf1202
  - kind: waits-on
    to: 01a0cf4b-e139-76b4-80cc-af9f930e0cfb
---
Build 4a of [[afbf1202]] (section 5): lanes admit `End` at the host; the managed spawner and the managed world's port open lanes; the typing operations take an operation key and no binding, generation or sequence; the trust subject keyed by execution and run; a thread's `Input` eligible only where it holds; the starter's lane at accept; `transfer_terminal` presenting the holder's scope; `control_terminal` and its floor retired; the capture instrument's `Keyboard` on a lane; saved take and release approvals withdrawn. It lands as a host release through a restart while no execution is live. Done when the 4a cases of section 7 hold, a reviewer on the builder's own rung found nothing left open, and doctor over the touched paths is clean.