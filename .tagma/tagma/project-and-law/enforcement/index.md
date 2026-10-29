---
id: 01a0eb13-d5e5-7914-93b0-f7c57abcb9a1
title: Enforcement
ord: 46
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "enforcement.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "serving.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "commits/hooks.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "rules/law.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "cli.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "cli/port.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "testing/",
        "role": "testing"
      },
      {
        "at": "operationChecks.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "commits/queue.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "commits/graphMerge.ts",
        "for": [
          "13182a9f"
        ]
      }
    ],
    "id": "enforcement",
    "kind": "substrate",
    "order": [
      [
        "contract/wire/"
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
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c6ef-834d-72bb-a092-d74196b75e80
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c703-263a-7a49-8a3d-0bfdc70821a1
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: imports
    to: 01a0d564-ec47-7645-8756-ec405e1647fa
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports
    to: 01a0fd8b-bef6-746f-b533-19bc00ddf0e5
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a12f83-9c8e-769f-8f0a-1f18e0801f50
  - kind: imports
    to: 01a1572e-6c3b-70eb-8a81-026d8fda30d8
  - kind: imports-tests
    to: 01a0fd8b-beef-70cb-81c5-89e59e75d459
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: apps/tagma/server/src/enforcement
---
Tagma judges a change against the project's enforced rules — with inspection workers and project programs — and writes the debt and escapes that keep the gate honest across commits. Enforcement owns the rule-check port, enforce_rule and its reads; the change, graph, command execution path and checkout come from callers, not inherited from its workers' state. A rule document carries the inspection key, and what and how to judge is described by the `tagma.config.ts` of the version under judgment: enforce_rule and remeasure read HEAD, a landing reads the commit tree, check_rules over a change reads HEAD with session lines.
