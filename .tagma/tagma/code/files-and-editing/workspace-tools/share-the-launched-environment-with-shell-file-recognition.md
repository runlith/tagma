---
id: 01a18a4c-4bc1-7081-8219-c0d02b37f6fe
title: Share the launched environment with shell file recognition
ord: 143
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-8236-7d99-9bb9-e8b5738cb12c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1425a-9f99-7e34-b270-543634c043b8
---
Take one effective environment snapshot per native bash launch and use it for both the process and ShellRun's file recognition. A callEnv HOME override must resolve home-relative reads in the home the command actually used; prove the override through the public bash door.