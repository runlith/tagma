---
id: 01a175e1-b116-7055-8be6-30fb49ba8614
title: Tagma on Windows x64 and arm64
ord: 3
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
Tagma installs and runs on Windows x64 and arm64. It is the biggest of the three platforms: execution host is written anew for Windows. The spec rests on [[fb401399|cut for the stated platform and feed with a per-platform archive]]. Each part's details are written before its work, from reading its code.

## What the code says

- **Execution host.** Windows holder module behind the `Platform` trait:
  - pseudo-terminal — ConPTY;
  - process groups — Job Objects;
  - handles handed over by duplication — the frame protocol already provides for it;
  - channel to the logic — named pipe.

  The POSIX adapter in the host logic gets a Windows neighbor.
- **Install and launch.**
  - No `sh`, `flock` or APFS clones.
  - `tagma.exe` instead of the sh launcher.
  - Hooks in repos without `sh`.
  - Paths and file-name case.
- **Agents.** Agent command shell: now `cmd.exe` on Windows (`packages/agent-tools/src/world/machine.ts`).
- **Window and machine.** Sound, input, window behavior, sleep prevention, opening apps and editors — a Windows variant or a declared absence with a cause.
- **Authenticode signing.** Without it SmartScreen warns everyone who downloaded Tagma. Microsoft Artifact Signing is open to individuals only in the US and Canada, so a CA certificate with a cloud-HSM key is needed. Buying it — the operator's decision.

## Where checked

Windows 11 ARM in a VM on a Mac with Apple silicon, x64 — through Prism inside it. Real x64 iron — testers.
