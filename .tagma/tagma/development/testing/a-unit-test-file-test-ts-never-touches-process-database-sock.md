---
id: 01a0d894-2428-72d7-b545-42b3ad3c527d
title: A unit-test file (`*.test.ts`) never touches process, database, socket, or disk; a test that needs them is `*.itest.ts`
ord: 7
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enabled": true
  }
sources:
  - kind: dir
    ref: .
---
`@runlith/testbed` rejects process, sqlite, socket (including loopback), and writes at the call site. Waiting in a test is at most 1 s.
