---
id: 01a1a8d6-c30f-7198-9e3a-ee5a70389308
title: A native lane shares one booted device; each test gets its own Safari process and page
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a19963-d6a1-7ab9-8064-62050d667f3f
sources:
  - kind: file
    ref: packages/e2e/src/lanes/simulator.ts
  - kind: file
    ref: packages/e2e/src/lanes/ios.ts
  - kind: file
    ref: packages/e2e/src/lanes/ios-contract.e2e.ts
---
On the macOS CI runner, cloning and cold-booting a device, then launching Safari and waiting for it to go quiet, measured 90–155 s before the first accessibility read or navigation (run 41927449628). Against the 180 s hang bound every phase shares, provisioning a device per test could not pass reliably. So a lane process clones and boots one device in its own guarded lane fixture, and removes it when the lane ends. Each test's guarded setup starts its own input driver, launches a fresh Safari process through the companion's PID receipt, waits for quiescence and opens its page; teardown terminates that Safari process.

What a shared device carries from one test to the next is Simulator-wide state: Safari's website data, caches and settings, and the restored tab a relaunch reopens before setup navigates away. So no test may depend on an earlier one's leftovers. Each page must stand on an origin no earlier test in the lane used, as a stand or server on its own port does, and a test that writes website data or settings on a shared origin resets them in its own setup.

Nested conformance children borrow their parent's lane device through the environment. They hold neither the machine-wide lane lock nor the device's lifetime, so the parent's setup bound covers only the child's per-test Safari setup.
