---
id: 01a0c704-a612-7c4c-9f81-5089acc2829b
title: Svelte testing
ord: 1
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/flush.ts",
        "role": "testing"
      },
      {
        "at": "src/mount-store.ts",
        "role": "testing"
      },
      {
        "at": "src/overrides.ts",
        "role": "testing"
      },
      {
        "at": "src/reactive.svelte.ts",
        "role": "testing"
      }
    ],
    "id": "@runlith/testing",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/testing
---
Svelte test suites stand on the same things: a way to let Svelte effects settle before the test looks at the DOM, a store created where the constructor can register effects and teardown, doubles with live getters, and a cell that forces a value changed mid-run to actually recompute. The package keeps this in one place so suites do not grow their own copies. State expectations and assertions poll for the condition without a deadline; an unrelated error surfaces at once, a hung test is ended by the testbed's safeguard. Not all are connected: some suites, such as the i18n component tests, still stand on their own stubs and bare `tick()`. Suites and the test modules the tested packages supply import it; jsdom patches live in the vitest binding [[feef9784]]. The package itself verifies nothing: what a test asserts stays in the test.
