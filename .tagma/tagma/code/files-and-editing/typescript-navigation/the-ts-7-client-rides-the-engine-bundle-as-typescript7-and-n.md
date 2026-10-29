---
id: 01a161b0-d96f-7211-8779-25761c2e1d0b
title: The TS 7 client rides the engine bundle as `typescript7`, and native `tsc` comes with the `tools/typescript` install
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/tools.ts
  - kind: file
    ref: packages/navigation-ts/package.json
---
The release bundles the server with `typescript` as an outside package and puts the TypeScript 6 used by code facts into the install's `node_modules`. Under the same name the `typescript/async` client from TS 7 inside the engine bundle would have resolved to that TS 6, where `./async` does not exist, and the engine would have fallen at startup. So the package is connected under the `typescript7` alias (`npm:typescript@7.1.0-beta`): it is not outside and lands in the `engineProcess.ts` bundle whole.

The native `tsc` is found by the client itself in the platform package next to it, and the install's `node_modules` has none. The release copies the platform package's `lib` directory (binary and `lib.*.d.ts` next to it) into `tools/typescript` and checks the launch with `--version`. Composition passes the path to the launcher as `compiler`; outside an install it is `null`, and the client finds the binary in the checkout's `node_modules`.
