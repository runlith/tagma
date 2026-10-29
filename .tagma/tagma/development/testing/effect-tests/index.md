---
id: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
title: Effect tests
ord: 2
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/testing.ts",
        "role": "testing"
      },
      {
        "at": "src/testing/",
        "for": [
          "b43ff1ba"
        ],
        "role": "testing"
      },
      {
        "at": "src/vitest.ts",
        "role": "testing"
      }
    ],
    "id": "@runlith/effect-test"
  }
sources:
  - kind: dir
    ref: packages/effect-test
---
The package joins the Effect lifecycle with Bun and Vitest: the test body gets its own Scope, TestClock and TestConsole; it.live keeps real time, layer builds the layer once per group and releases it after. Runner doors are separate, while execution, interruption and fixture-scope ownership are shared: the Vitest consumer does not load bun:test. Result assertions stay with the chosen runner's expect.
