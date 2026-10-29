---
id: 01a0eed5-adb6-7d6f-971c-a67a083d37f1
title: An import crosses into another module only over a declared relation and through an entry open to the importer
ord: 10
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/AcceptedRecovery.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 10,
          "path": "packages/execution-host/src/AcceptedRecovery.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/CommandDeadline.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 14,
          "path": "packages/execution-host/src/CommandDeadline.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/CommandInventory.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 14,
          "path": "packages/execution-host/src/CommandInventory.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/CommandLifetime.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 12,
          "path": "packages/execution-host/src/CommandLifetime.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/CompilerQualification.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 10,
          "path": "packages/execution-host/src/CompilerQualification.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/EvictedRangeRead.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 10,
          "path": "packages/execution-host/src/EvictedRangeRead.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/ExecutionRetention.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 8,
          "path": "packages/execution-host/src/ExecutionRetention.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/ExecutionRuntime.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 21,
          "path": "packages/execution-host/src/ExecutionRuntime.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/ExecutionStoreLoss.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 8,
          "path": "packages/execution-host/src/ExecutionStoreLoss.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/ExecutionTerminal.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 10,
          "path": "packages/execution-host/src/ExecutionTerminal.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/InventoryChanges.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 9,
          "path": "packages/execution-host/src/InventoryChanges.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/PipelineDeath.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 15,
          "path": "packages/execution-host/src/PipelineDeath.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/ReleasedRecords.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 11,
          "path": "packages/execution-host/src/ReleasedRecords.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/UnwatchableExit.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 16,
          "path": "packages/execution-host/src/UnwatchableExit.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/composition/testing/lateCapacity.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 11,
          "path": "packages/execution-host/src/composition/testing/lateCapacity.itest.ts",
          "said": "imports `../../Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/composition/testing/launchUncertain.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 17,
          "path": "packages/execution-host/src/composition/testing/launchUncertain.itest.ts",
          "said": "imports `../../Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/composition/testing/receiptCapacity.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 15,
          "path": "packages/execution-host/src/composition/testing/receiptCapacity.itest.ts",
          "said": "imports `../../Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/inventoryReading.bench.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 10,
          "path": "packages/execution-host/src/inventoryReading.bench.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        },
        {
          "commit": "94d31df7a2ca97e6929e83508a02dcb6c32bb736",
          "fingerprint": "host-composition -> @runlith/execution-host private @ packages/execution-host/src/terminalRelease.itest.ts",
          "fix": "Import through an entry `@runlith/execution-host` opens to `host-composition` (`packages/execution-host/`, `packages/execution-host/src/host.ts`, `packages/execution-host/src/hostSpawner.ts`, `packages/execution-host/src/hostTelemetry.ts`, `packages/execution-host/src/PlatformFacts.ts`, `packages/execution-host/src/ProcessTempo.ts`, `packages/execution-host/src/Endpoint.ts`, `packages/execution-host/src/Credentials.ts`, `packages/execution-host/src/ProcessReader.ts`, `packages/execution-host/src/EvidenceScans.ts`, `packages/execution-host/src/UsageReader.ts`, `packages/execution-host/src/processTree.ts`, `packages/execution-host/src/Residuals.ts`, `packages/execution-host/src/ProcessControl.ts`, `packages/execution-host/src/TerminalInputs.ts`), or open one covering `packages/execution-host/src/Bindings.ts` with `set_module`.",
          "line": 26,
          "path": "packages/execution-host/src/terminalRelease.itest.ts",
          "said": "imports `./Bindings` of module `@runlith/execution-host`, which no entry of `@runlith/execution-host` opens to `host-composition`"
        }
      ],
      "inspection": "modules",
      "on": [
        {
          "op": "submit_work",
          "phase": "before"
        },
        {
          "op": "merge_worktree",
          "phase": "before"
        }
      ],
      "strictness": "gate"
    }
  }
sources:
  - kind: dir
    ref: .
---
A module's boundaries — its root, entries, relations and `order` — stand on its #module card, and `set_module` changes them. Inside a module, imports run only down the card's `order`. Only test code enters another module's `testing` entry; production relations stand in an acyclic order, and a test-only relation (`imports-tests`) does not close a cycle; every file of the region belongs to a module.
