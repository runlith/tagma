---
id: 01a13db9-1a27-7094-91c2-02514ba13de6
title: The chat-ui Effect tests and their scoped harness use a shared Bun/Vitest runner
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c18-57a3-7669-b310-5a9d8bf9a4d6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-3989-7140-b4b7-a20c407453a6
sources:
  - kind: dir
    ref: packages/chat-ui
  - kind: dir
    ref: packages/effect-test
---
Migrate the current packages/chat-ui Effect tests to @runlith/effect-test and make chatHarness a scoped Effect factory with no hidden runner. The Vitest door uses the shared execution mechanism and fixture scopes, keeps TestClock/TestConsole, the Svelte runtime and jsdom isolation; the current Bun surface stays unchanged. Proof is type and behaviour checks, narrow effect-style with no wholesale Vitest-code exception, two independent Sol reviews of the shared runner, commit.
