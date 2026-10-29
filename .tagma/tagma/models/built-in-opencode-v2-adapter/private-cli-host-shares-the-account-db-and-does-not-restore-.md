---
id: 01a16488-f9dc-7a4b-a885-48aceb2c9f20
title: Private CLI host shares the account DB and does not restore other sessions
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/adapter-opencode/src/environment.ts
  - kind: file
    ref: packages/adapter-opencode/src/host.ts
---
OpenCode V2 credentials and conversations live in one profile database. Thread processes therefore share the account HOME/XDG but start as unregistered serve: in this version, the embedded SDK and managed service can resume orphan executions that have no live hosted run. EOF on stdin ends the private host without deleting the profile; a strict version check comes before opening the database.
