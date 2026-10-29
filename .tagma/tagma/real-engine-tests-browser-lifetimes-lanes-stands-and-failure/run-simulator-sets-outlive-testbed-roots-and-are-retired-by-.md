---
id: 01a183f0-c4eb-727a-887a-bc3cc0f94f85
title: Run Simulator sets outlive testbed roots and are retired by their lane; the onboarded template is shared
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/lanes/simulator.ts
  - kind: file
    ref: packages/e2e/src/lanes/template.ts
---
CoreSimulator owns each launchd_sim, so worker death closes neither the device nor its operating-system services. The lane keeps its private sets and run-identity ledger beside its pinned tool cache: a testbed root may disappear before the operating system retires a device. It publishes identity before creating a device and removes the state only after CoreSimulator reports the set empty; the process reaper cannot perform this retirement. A missing run root is ended; for a root still present, testbed supplies liveness so the lane does not invent a competing ownership test.

The onboarded Safari template is the one device no run owns. First boot with data migration plus onboarding costs minutes, which would put every run's setup at the hang guard. So the template is prepared once per runtime build, CoreSimulator version, device type and pinned tool versions, normally by the tool-preparation script, under that identity's file lock, and shut down. It is published by a record written only after it shuts down. Each clone into a run-owned set happens under the same lock, after the record and device have been checked again, so a run never holds a template identity across clones. Building a template removes the templates its identity supersedes: the same runtime and device type, other tool or CoreSimulator versions, or an uninstalled runtime build. Templates of other runtimes or device types stay, because one run may use several.