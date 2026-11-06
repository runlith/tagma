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
    ref: packages/e2e/src/lanes/ios-contract.e2e.ts
  - kind: file
    ref: packages/e2e/src/lanes/ios.ts
  - kind: file
    ref: packages/e2e/src/lanes/simulator.ts
---
On the macOS CI runner, cloning and cold-booting a device, then launching Safari and waiting for it to go quiet, measured 90–155 s before the first accessibility read or navigation (run 41927449628). Against the 180 s hang bound every phase shares, provisioning a device per test could not pass reliably. Boot completion still leaves the device's first app launch carrying the settling cost: it measured 3–110 s on a cold clone, and 110 s in run 41934199447 alone exceeded a phase's bound. So the cold device work leaves the tests. In CI, a workflow step before the tests clones and boots the lane device, launches Safari once through the companion PID receipt, quiescence and native geometry, terminates it, and names the device in `E2E_IOS_DEVICE`. Each lane process adopts that device in its guarded lane hook and never removes it; the machine-wide lane lock still lets only one lane process use it at a time. Without that variable, as in local runs, the lane clones and boots its own device in a guarded hook, removes it when the lane ends, and runs the first launch in a second guarded phase. Each test's guarded setup starts its own input driver, launches a fresh Safari process through the companion's PID receipt, waits for quiescence and opens its page; teardown navigates that page to about:blank and then terminates the Safari process.

What a shared device carries from one test to the next is Simulator-wide state: Safari's website data, caches and settings, and the tab a relaunch restores before setup navigates away. Teardown leaves that tab on about:blank because a restored stand page broke the next test's navigation: when setup left the restored stand URL for about:blank and the test then reopened that same URL, Page.loadEventFired sometimes never came, and opening waited until the hang bound. In run 41954826175 this hung 2 of 7 starts that restored the previous scenario's stand URL and none of the 4 that restored about:blank; run 41942056948 showed the same shape. So tests may share one origin, as all of a file's scenarios share its stand server, provided none depends on an earlier one's leftovers: a test that writes website data or settings on a shared origin resets them in its own setup.

Nested conformance children borrow their parent's lane device through the environment. They hold neither the machine-wide lane lock nor the device's lifetime, so the parent's setup bound covers only the child's per-test Safari setup.
