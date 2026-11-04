---
id: 01a19963-d6a1-7ab9-8064-62050d667f3f
title: The e2e recorder requests failure evidence before releasing its fixture scope
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/artifacts.ts
  - kind: file
    ref: packages/e2e/src/browser.ts
  - kind: file
    ref: packages/e2e/src/lanes/ios.ts
  - kind: file
    ref: packages/e2e/src/lanes/ios-contract.e2e.ts
---
Native registration provisions the lane's device in a lane fixture, and each test's Safari process and page inspection in a per-test setup hook, both reporting their cost as tenant work. The native registrar and its nested-process conformance share one recorded-fixture lifecycle. Setup, scenario and teardown use the same hang bound and artifact recording; the fixture scope outlives the phase fibers, so setup and body failures request the available evidence before cleanup. A parent waits for the child's native-ready handshake in setup and releases the scenario in its body; child reports remain beside the parent's artifacts, and cleanup waits for the child to finish its own evidence and resource release. Native callbacks use `Infinity` to leave the bound with the recorder because Bun 1.4.4 can fire an earlier hook’s timer during a later test, while zero makes its process-killer expire the test before evidence is saved. Capture failures remain part of the failed outcome.