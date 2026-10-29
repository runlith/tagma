---
id: 01a16eae-50ae-7da2-937f-4d2127066bc4
title: Desktop checks from a clean tree get kit sources and a pre-prepared Electron
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a94-8d3a-7610-abd9-8503665bc41f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Fix the x-worlds and handed-over x-runner prerequisites: desktop:test cannot find window-behavior/contract/state without dist; Electron 44.8.0 downloads its binary on require inside identity.itest. Bun gets the existing sources through a declared export condition; Node/Electron keep the dist contract. Electron is prepared before testbed, without lengthening the test run. Check the public package doors and the affected tests; land your own lines and finish with held paths = 0.
