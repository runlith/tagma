---
id: 01a189de-7fc8-714e-ae26-74fa0df8a9b5
title: Under jsdom a Response answers its bytes in a buffer of the test's realm
ord: 27
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/vitest/jsdom.ts
---
Under jsdom the HTTP client the app's door runs on refuses the buffer a `Response` answers ("Expected ArrayBuffer"), because that buffer belongs to another realm than the test's. The shim copies the bytes into a buffer of the test's realm, so a door test answers with a plain `Response` instead of carrying its own workaround.
