---
id: 01a1607b-fb0f-7740-872d-bfd70f413665
title: Release 0.1.7 was refused over home paths in execution native artifacts
ord: 20
tags: ["reflection"]
fields:
  {
    "actual": "After 1m 29s, release-refused on proof: libexecution_platform.dylib and execution-holder carry a path under ~; notarization never started.",
    "command": "CARGO_BUILD_JOBS=3 CMAKE_BUILD_PARALLEL_LEVEL=3 MAKEFLAGS=-j3 bun run tagma:release --notarize --version 0.1.7 --json",
    "expected": "Build the release without build-machine paths and complete notarization."
  }
---
Filed from project `runlith`.