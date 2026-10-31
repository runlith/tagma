---
id: 01a193f6-b5a6-7b27-880c-f9e668027cea
title: Keep accepted child tasks available across run withdrawal
ord: 144
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a192d4-2a45-7ef5-b59d-42722879615c
---
Reproduce the send_task report where withdrawn runs consume the assignment while its request remains open. Fix durable delivery at the thread or harness owner, preserving one open obligation and task text across recovery. Prove the scenario through the caller's public door, commit and answer the reflection; do not change recovery product policy.