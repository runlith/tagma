---
id: 01a17177-8aaa-7fd9-87cb-4d7b59de2143
title: Cmd+V with a buffered image pastes it into the CLI thread's terminal as a path the CLI will attach
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17100-a232-7a0a-a781-94f0e2744109",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1715a-0feb-7a87-b61b-0a2b6418cf23
---
In Claude Code's own terminal a buffered image is pasted with a key combination. Tagma's terminal reads only text on Cmd+V, so the image never arrives. When the buffer holds no text but the terminal accepts files, a buffered image takes the same path as a dropped file: a copy on the server in the thread's folder, the copy's path pasted in image form.
