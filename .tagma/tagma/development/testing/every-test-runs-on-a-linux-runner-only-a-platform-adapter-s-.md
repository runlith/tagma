---
id: 01a19ec6-f467-787a-a87e-89cb77c57d56
title: Every test runs on a Linux runner; only a platform adapter's own tests run on that platform's runner
ord: 18
tags: ["rule"]
sources:
  - kind: dir
    ref: .github
---
Shared code — the core, product logic, kits — passes the same on every OS, so its unit, integration and e2e tests run on Linux. A test whose subject is a platform adapter — the macOS execution host, Swift packages, signing, the iOS Simulator, the macOS window and desktop lanes — runs on that platform's runner and only there. A test of shared code that cannot pass on Linux marks a defect of the shared code: the place where it knows an OS moves behind an adapter. Typecheck, formatting, inspections and builds run on Linux.