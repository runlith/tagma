---
id: 01a1929e-59f5-7c36-a63c-f14a754beec1
title: A client's connections close with the client, after its later-acquired consumers
ord: 89
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/executions/src/ExecutionClient.ts
---
A consumer may still call the client from its release, including to reconnect. Lazily attaching connection scopes to the consumer's enclosing scope would close them before that release and make reconnect inherit an already-closed scope. The client acquires its own scope when it is made, so connection creation never changes its position in the enclosing scope's release order.