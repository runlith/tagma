---
id: 01a127e3-cc5c-73fa-99ff-b228d2a60527
title: Host composition
ord: 40
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "testing/",
        "role": "testing"
      },
      {
        "at": "platform.ts",
        "for": [
          "13182a9f",
          "6cc306ce"
        ]
      },
      {
        "at": "artifact.ts",
        "for": [
          "921755ee"
        ]
      }
    ],
    "id": "host-composition"
  }
edges:
  - kind: imports
    to: 01a0c6ef-834d-72bb-a092-d74196b75e80
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
  - kind: imports
    to: 01a0fd8b-bf17-7729-bc6f-2284f37a2606
  - kind: imports
    to: 01a1165d-b047-7099-969a-602c520698f4
  - kind: imports
    to: 01a12759-8915-7d38-82d6-94c9921755ee
  - kind: imports
    to: 01a12792-64d6-7374-bc46-a942ec75f4da
  - kind: imports
    to: 01a12880-2e3b-7b5b-826f-7192e9de12e3
  - kind: imports
    to: 01a13b1a-1851-79b3-ba84-3b0e9f581885
  - kind: imports-tests
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports-tests
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: imports-tests
    to: 01a12893-cecf-7798-9b3d-e2ed4a42e855
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
  - kind: imports-tests
    to: 01a16b71-3a1f-7cfb-a633-2283feef9784
sources:
  - kind: dir
    ref: packages/execution-host/src/composition
  - kind: file
    ref: packages/execution-host/src/AcceptedRecovery.itest.ts
  - kind: file
    ref: packages/execution-host/src/buildArtifact.ts
  - kind: file
    ref: packages/execution-host/src/bundleBoot.itest.ts
  - kind: file
    ref: packages/execution-host/src/CommandDeadline.itest.ts
  - kind: file
    ref: packages/execution-host/src/CommandInventory.itest.ts
  - kind: file
    ref: packages/execution-host/src/CommandLifetime.itest.ts
  - kind: file
    ref: packages/execution-host/src/CompilerQualification.itest.ts
  - kind: file
    ref: packages/execution-host/src/Credentials.itest.ts
  - kind: file
    ref: packages/execution-host/src/EvictedRangeRead.itest.ts
  - kind: file
    ref: packages/execution-host/src/evidenceDispatch.itest.ts
  - kind: file
    ref: packages/execution-host/src/ExecutionCapacity.itest.ts
  - kind: file
    ref: packages/execution-host/src/ExecutionRetention.itest.ts
  - kind: file
    ref: packages/execution-host/src/ExecutionRuntime.itest.ts
  - kind: file
    ref: packages/execution-host/src/ExecutionStoreLoss.itest.ts
  - kind: file
    ref: packages/execution-host/src/ExecutionTerminal.itest.ts
  - kind: file
    ref: packages/execution-host/src/grantReclaim.itest.ts
  - kind: file
    ref: packages/execution-host/src/host.itest.ts
  - kind: file
    ref: packages/execution-host/src/hostConformance.itest.ts
  - kind: file
    ref: packages/execution-host/src/HostConnections.itest.ts
  - kind: file
    ref: packages/execution-host/src/hostDeath.itest.ts
  - kind: file
    ref: packages/execution-host/src/hostExit.itest.ts
  - kind: file
    ref: packages/execution-host/src/hostLaunch.ts
  - kind: file
    ref: packages/execution-host/src/hostLifetime.itest.ts
  - kind: file
    ref: packages/execution-host/src/hostLoad.bench.ts
  - kind: file
    ref: packages/execution-host/src/hostProcess.itest.ts
  - kind: file
    ref: packages/execution-host/src/hostTelemetry.itest.ts
  - kind: file
    ref: packages/execution-host/src/InventoryChanges.itest.ts
  - kind: file
    ref: packages/execution-host/src/inventoryGap.itest.ts
  - kind: file
    ref: packages/execution-host/src/inventoryReading.bench.ts
  - kind: file
    ref: packages/execution-host/src/MachineLoad.itest.ts
  - kind: file
    ref: packages/execution-host/src/main.ts
  - kind: file
    ref: packages/execution-host/src/managedShell.itest.ts
  - kind: file
    ref: packages/execution-host/src/nativeLaunch.itest.ts
  - kind: file
    ref: packages/execution-host/src/NativeUsage.stest.ts
  - kind: file
    ref: packages/execution-host/src/PipelineDeath.itest.ts
  - kind: file
    ref: packages/execution-host/src/ProvenSet.itest.ts
  - kind: file
    ref: packages/execution-host/src/readerRelease.itest.ts
  - kind: file
    ref: packages/execution-host/src/readings.darwin.itest.ts
  - kind: file
    ref: packages/execution-host/src/recovery.itest.ts
  - kind: file
    ref: packages/execution-host/src/recovery.ts
  - kind: file
    ref: packages/execution-host/src/recoveryRequests.itest.ts
  - kind: file
    ref: packages/execution-host/src/ReleasedRecords.itest.ts
  - kind: file
    ref: packages/execution-host/src/releasedSubscription.itest.ts
  - kind: file
    ref: packages/execution-host/src/shellHostDeath.itest.ts
  - kind: file
    ref: packages/execution-host/src/terminalEcho.bench.ts
  - kind: file
    ref: packages/execution-host/src/terminalRelease.itest.ts
  - kind: file
    ref: packages/execution-host/src/UnwatchableExit.itest.ts
---
The host composition binds the kernel's independent ports to the platform adapter and runs them in one scope; choosing the OS and loading its native parts belongs to this composition. The assembled host's checks on its own holder and in a separate state directory live here too; what to run and how to conduct an execution is the kernel's call.
