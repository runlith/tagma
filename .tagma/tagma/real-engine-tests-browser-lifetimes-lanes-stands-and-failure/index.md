---
id: 01a1835e-fd16-7556-8288-d03ba287d79f
title: "Real-engine tests: browser lifetimes, lanes, stands and failure artifacts"
ord: 1215
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/browser.ts",
        "role": "testing"
      },
      {
        "at": "src/engines.ts",
        "role": "testing"
      },
      {
        "at": "src/artifacts.ts",
        "role": "testing"
      },
      {
        "at": "src/stand.ts",
        "role": "testing"
      },
      {
        "at": "src/lanes/ios.ts",
        "role": "testing"
      },
      {
        "at": "src/lanes/simulator.ts",
        "for": [
          "a287d79f"
        ],
        "role": "testing"
      },
      {
        "at": "src/touch.ts",
        "role": "testing"
      },
      {
        "at": "src/lanes/hid.ts",
        "for": [
          "a287d79f"
        ],
        "role": "testing"
      },
      {
        "at": "src/lanes/input.ts",
        "for": [
          "a287d79f"
        ],
        "role": "testing"
      }
    ],
    "id": "@runlith/e2e"
  }
edges:
  - kind: imports
    to: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
  - kind: imports
    to: 01a1835e-fcdd-7b33-bb06-eb8bb3df9a16
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
  - kind: imports-tests
    to: 01a16b71-3a1f-7cfb-a633-2283feef9784
sources:
  - kind: dir
    ref: packages/e2e
---
End-to-end tests and measuring stands share real-engine lifetimes and failure evidence under the test stand's budget; product worlds and assertions remain with the surfaces being exercised. Desktop lanes isolate browser contexts; MobileSafari publishes a shutdown template as run-world data and gives each scenario a scoped clone. The Simulator lane retires its ended runs' private device sets because CoreSimulator's services outlive the test worker and cannot be owned by its process reaper.