---
id: 01a12701-82bb-7e0b-9550-8291fd2bcad6
title: "An agent command has two limits: waiting moves it to the background, life kills it; their defaults and ceilings stand in the command contract"
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent-tools/src/CommandWork.ts
---
`COMMAND_WAIT` and `COMMAND_LIFE` live in the command contract, not with the server: they are read by the `bash` schema and description, by rule resolution on the server, and by the words to the agent, and `agent-tools` cannot import the server.

- **2 minutes of waiting** fit a package's check, typecheck, and tests and never hold the agent in place longer: it receives a slow command by notification and works on. This is inside the prompt cache's 5-minute life.
- **10 minutes of waiting** is one act's ceiling (`LONGEST_ACT_MS`): a call is never held in place longer; the call envelope guards it.
- **1 hour of life** covers builds and full runs, and a hung command never loads the machine past an hour.
- **6 hours of life** is for long downloads; anything longer or permanent is a terminal, which obeys no limit.

The numbers were approved by the operator on 2026-10-10; waiting was lowered by them to 2 minutes on 2026-10-11. Waiting does not kill: when it runs out, `bash` calls `CallProgress.handOff`, the call moves to the background by the same path as on the operator's word, and the outcome arrives by notification.
