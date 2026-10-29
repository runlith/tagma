---
id: 01a175e1-b116-7055-8be6-30f8bf4b204e
title: "Tagma on macOS (Apple silicon and Intel), Linux and Windows: a release for each platform"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
---
Tagma installs and runs on Mac with Apple silicon and Intel, on Linux (x64 and arm64) and on Windows (x64 and arm64). A release has one number and one feed, the feed holds an archive per platform, update runs with human consent as now.

## What stands now

The release is cut for the machine it is cut on: cut takes `process.platform` and `process.arch`, the build machine's bun and native packages from its `node_modules`. Every place where Tagma touches the OS has only a macOS variant:
- execution holder — [[4a736f36|the single macOS-only module]];
- install — sh launcher, `flock`, APFS clones (`cp -c`), DMG;
- sound, input, window behavior, sleep prevention (`caffeinate`), opening apps and editors (LaunchServices), `codesign` signing.

The feed carries one archive per release. In the [[e7b7be7f|Mac release]] spec Intel, Linux and Windows are out of scope.

The core is already separated from the OS: the holder works through the `Platform` trait, the frame protocol between holder and logic knows no OS and already provides for a platform that hands handles over by duplication. So the work is variants per OS and a build for the stated platform, not a core rewrite.

## Shared decisions

- **Platform is a cut parameter**, written as `<os>-<arch>`: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, `win32-arm64`. Each native part is taken or built for that platform by its owner; the core never branches by OS ([[6f758080]]). Checkout builds (Tagma Dev, beside, try) stay on their own machine's platform.
- **One release — one number and one feed**, the release record holds each platform's archive. The client takes its own machine platform's archive. A release with no archive for the platform yet is not offered to that platform.
- **What a platform lacks is declared**: the interface names the missing capability and the cause, as Whisper now declares its absence with a file. Reaching a platform never waits for every native function.
- **Each OS builds on its own OS.** Both macOS architectures are cut on a Mac with Apple silicon. Linux and Windows — on their own OS machine, second architecture — cross-build where the toolchain gives it.

## Order

1. [[fb401399|Mac of both architectures]] — foundation: cut for the stated platform and feed with a per-platform archive is needed by all the rest.
2. [[13792520|Linux]] — closest to macOS through POSIX.
3. [[49ba8614|Windows]] — the biggest part: execution host written anew.

## Where it is checked

The developer has one machine — a Mac with Apple silicon.
- macOS arm64 — on it; macOS x64 — there under Rosetta. Rosetta translates x64 code but never proves work on an Intel processor and its speed.
- Linux arm64 and Windows 11 ARM — virtual machines on it, at native speed; x64 builds — inside them by emulation (Rosetta for Linux, Prism).
- Real x64 iron, the Intel Mac first — testers on their own machines before launch.

## Out of scope

- Open repo and CI: the operator runs them separately.
- Mac App Store, Microsoft Store, distro repo packages.
- Which platforms to launch with — the operator's launch decision.
