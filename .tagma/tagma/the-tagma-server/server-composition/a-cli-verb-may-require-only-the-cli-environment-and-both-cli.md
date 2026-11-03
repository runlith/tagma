---
id: 01a1a35c-3fb5-785d-9f9b-66130c27e1f4
title: A CLI verb may require only the CLI environment, and both CLI entries provide it from one layer
ord: 49
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1a34d-1ec8-7d17-a053-7559fb879943
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cli/environment.ts
---
`invoke` keeps in its type what the loaded verbs require, and every verb module a build lists is checked against `CliEnvironment` at its row (`CORE_VERB_MODULES`, a build descriptor). A verb that starts requiring a service outside it fails typecheck there; the service then joins `CliEnvironment` and `cliEnvironment`, and both `runCli` and the test entry `capturedEffect` get it, because both provide that one layer. While `invoke` erased the requirement, the test entry lacked `Processes`, and every `tagma web` in it exited 1 at runtime with `Service not found`.

A loaded verb record holds commands and an optional `preface` only: a helper returned beside the commands takes the module out of the type, together with its manifest.

The `hook` verb outside an entered start is the one path given less: it loads the hook verb alone and gets what that verb requires, without the native process layer; the hook verb's own inferred type keeps that path checked.
