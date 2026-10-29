---
id: 01a0fd8b-bf01-77d4-950b-191990491249
title: Managed executions
ord: 45
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "executions.ts"
      },
      {
        "at": "assembly.ts"
      },
      {
        "at": "ports.ts"
      },
      {
        "at": "cli.ts"
      },
      {
        "at": "terminals/orcaProfile.ts"
      },
      {
        "at": "commands/outputTail.ts",
        "for": [
          "1a45453a"
        ]
      },
      {
        "at": "commands/ruleResolution.ts",
        "for": [
          "13182a9f",
          "1a45453a"
        ]
      },
      {
        "at": "store/standingRules.ts",
        "for": [
          "13182a9f",
          "ab05dfec",
          "1a45453a"
        ]
      },
      {
        "at": "terminals/principals.ts",
        "for": [
          "13182a9f",
          "7abcb9a1",
          "287a4906",
          "9543a701",
          "06405a5f",
          "c6922284",
          "8fda30d8",
          "2043c3ca"
        ]
      },
      {
        "at": "terminals/refusal.ts",
        "for": [
          "13182a9f",
          "287a4906",
          "1a45453a",
          "2043c3ca"
        ]
      },
      {
        "at": "terminals/subjectPolicy.ts",
        "for": [
          "13182a9f",
          "287a4906",
          "2043c3ca"
        ]
      },
      {
        "at": "testing/",
        "role": "testing"
      },
      {
        "at": "host/processes.ts",
        "role": "testing"
      },
      {
        "at": "host/environmentBackend.ts",
        "for": [
          "c6922284"
        ]
      },
      {
        "at": "operations/commandRules.ts",
        "for": [
          "ab05dfec"
        ]
      },
      {
        "at": "worlds/machine.ts",
        "for": [
          "c6922284"
        ]
      },
      {
        "at": "commands/times.ts",
        "for": [
          "13182a9f",
          "ab05dfec",
          "1a45453a"
        ]
      },
      {
        "at": "store/terminal.ts",
        "for": [
          "ab05dfec"
        ]
      },
      {
        "at": "host/offer.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "host/staying.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "commands/feedDelta.ts",
        "for": [
          "1edee1c2"
        ]
      },
      {
        "at": "settings.ts",
        "for": [
          "1edee1c2"
        ]
      }
    ],
    "id": "executions",
    "kind": "product",
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
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c702-a15a-7740-ab79-497190d97bc9
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
    to: 01a0fd8b-beef-70cb-81c5-89e59e75d459
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports
    to: 01a0fd8b-befd-77ef-ac51-f681d12dd963
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
  - kind: imports
    to: 01a12880-2e3b-7b5b-826f-7192e9de12e3
  - kind: imports
    to: 01a14828-bfa9-7e91-992b-e05c97a922df
  - kind: imports-tests
    to: 01a0c6ef-834d-72bb-a092-d74196b75e80
sources:
  - kind: dir
    ref: apps/tagma/server/src/executions
---
Every agent command and every operator terminal is a managed execution on the execution host, and the module owns it: launching, awaiting and stopping commands, terminals, their screen, input and handover, time rules for commands, the world a command runs in, machine load and host change. The host process itself is the execution-host package; what to launch is decided by agents and the operator.
