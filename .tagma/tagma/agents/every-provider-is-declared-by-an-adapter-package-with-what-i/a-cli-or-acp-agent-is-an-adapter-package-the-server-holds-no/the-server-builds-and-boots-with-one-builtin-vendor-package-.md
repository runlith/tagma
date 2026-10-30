---
id: 01a18d5f-d162-74ec-b7f8-f900b60e3ad5
title: The server builds and boots with one builtin vendor package removed, and none of its code ships
ord: 9
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: waits-on
    to: 01a18d5f-6f01-75b8-81ef-003b8cc83f67
  - kind: waits-on
    to: 01a18d5f-6f42-72f4-a04e-6d5e29b14a0e
  - kind: waits-on
    to: 01a18d5f-6f9f-791b-a661-e0bf3bd6b3d6
  - kind: waits-on
    to: 01a18d5f-6ff2-76f6-a95c-553c3a4752ab
  - kind: waits-on
    to: 01a18d5f-862b-73c3-8598-6617dc84f88b
---
Acceptance 8 of [[57787448]] and 5 of [[6f376186]], proved once after the last vendor landing: one builtin vendor package removed from the server's dependencies and host modules; the build and boot succeed and the bundle carries none of its code. Then close both specs if nothing else is open.