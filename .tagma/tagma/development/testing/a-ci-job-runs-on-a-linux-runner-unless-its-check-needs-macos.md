---
id: 01a19ec6-f467-787a-a87e-89cb77c57d56
title: A CI job runs on a Linux runner unless its check needs macOS
ord: 18
tags: ["rule"]
sources:
  - kind: dir
    ref: .github
---
macOS is for checks that cannot run anywhere else: the execution host and the server's integration tests over it, Swift packages, the iOS Simulator, the macOS window and desktop lanes. Typecheck, formatting, inspections, builds and unit tests run on Linux.
