---
id: 01a1572e-6c3b-70eb-8a81-026d8fda30d8
title: Repository config
ord: 48
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "config.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "config",
    "kind": "substrate",
    "order": [
      [
        "contract/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports-tests
    to: 01a1165d-b047-7099-969a-602c520698f4
sources:
  - kind: dir
    ref: apps/tagma/server/src/config
---
The repository declares in `tagma.config.ts` what Tagma judges its code with and rewrites commits with, and the module answers "what does this version's config declare": it reads the version's files from the git tree, assembles and runs the config in a separate Bun Tagma process with no environment and with access to clocks and randomness refused, caches the result by content in the git common dir, and answers with a typed `Config` carrying the server schemas' defaults, or a `config-invalid` refusal with a place. The `read_config` operation gives the same answer for the HEAD config — keys and commands, without the rules referencing them — and whether HEAD holds `tagma.config.ts` the module answers with the `config` fact that brings the format section into the prompt. Which key judges what and how format commands run is decided by enforcement and the commit steps.
