---
id: 01a0fd8b-bf17-7729-bc6f-2284f37a2606
title: Execution host
ord: 37
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": ".",
        "for": [
          "f37a2606",
          "d2a60527"
        ]
      },
      {
        "at": "src/host.ts",
        "for": [
          "d2a60527"
        ]
      },
      {
        "at": "src/hostSpawner.ts",
        "for": [
          "d2a60527"
        ]
      },
      {
        "at": "src/hostTelemetry.ts",
        "for": [
          "d2a60527"
        ]
      },
      {
        "at": "src/PlatformFacts.ts",
        "role": "port"
      },
      {
        "at": "src/ProcessTempo.ts",
        "role": "port"
      },
      {
        "at": "src/Endpoint.ts",
        "role": "port"
      },
      {
        "at": "src/Credentials.ts",
        "role": "port"
      },
      {
        "at": "src/ProcessReader.ts",
        "role": "port"
      },
      {
        "at": "src/EvidenceScans.ts",
        "role": "port"
      },
      {
        "at": "src/UsageReader.ts",
        "role": "port"
      },
      {
        "at": "src/processTree.ts"
      },
      {
        "at": "src/Residuals.ts"
      },
      {
        "at": "src/ProcessControl.ts",
        "role": "port"
      },
      {
        "at": "src/TerminalInputs.ts",
        "role": "port"
      },
      {
        "at": "src/ExecutionInput.ts",
        "for": [
          "921755ee"
        ]
      },
      {
        "at": "src/Bindings.ts",
        "for": [
          "921755ee",
          "d2a60527"
        ]
      }
    ],
    "id": "@runlith/execution-host",
    "kind": "substrate"
  }
edges:
  - kind: imports
    to: 01a0c6ef-834d-72bb-a092-d74196b75e80
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a1165d-b047-7099-969a-602c520698f4
  - kind: imports
    to: 01a12792-64d6-7374-bc46-a942ec75f4da
  - kind: imports-tests
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: imports-tests
    to: 01a12880-2e3b-7b5b-826f-7192e9de12e3
  - kind: imports-tests
    to: 01a16b71-3a1f-7cfb-a633-2283feef9784
sources:
  - kind: dir
    ref: packages/execution-host
---
Commands and terminals run in a separate host process that lives independently of the server; the host kernel conducts executions through its own platform and holder ports, writes bytes, mirrors the screen, takes input, stops work and accounts resources. The product contract is `@runlith/executions`; the server decides what to run, and composition binds the platform implementations.
