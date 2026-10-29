---
id: 01a14828-bfac-7563-abdb-860cac637dff
title: Managed Chromium
ord: 29
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "managed-browser.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "managed-browser",
    "order": [
      [
        "contract/"
      ],
      [
        "builds/"
      ],
      [
        "."
      ],
      [
        "testing/"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a14828-1f15-7e60-8663-f3c1496f9eb4
  - kind: imports
    to: 01a14828-bfa9-7e91-992b-e05c97a922df
  - kind: imports
    to: 01a1835e-fcdd-7b33-bb06-eb8bb3df9a16
  - kind: imports-tests
    to: 01a16b71-3a1f-7cfb-a633-2283feef9784
  - kind: imports-tests
    to: 01a1700a-01ee-7877-a187-0c4a8f8c2801
sources:
  - kind: dir
    ref: apps/tagma/server/src/managed-browser
---
Agents need a browser even when the Tagma app is not running, and the engine needs a real target for integration tests; the module is the `managed` host adapter filling the browser module's `PageHost` and `ProfileHost` ports: it starts Chromium per profile as a windowless server child process with a UA free of `HeadlessChrome`, speaks CDP to it over `--remote-debugging-pipe`, keeps a service session with a single `Page` on every page, unloads long-abandoned pages and takes the build from the profile document — Chrome for Testing, installed from official URLs into the data directory, or installed Google Chrome. Automation, broadcast, page records and refusals to the agent stay with the browser module; composition gives it directories and processes.
