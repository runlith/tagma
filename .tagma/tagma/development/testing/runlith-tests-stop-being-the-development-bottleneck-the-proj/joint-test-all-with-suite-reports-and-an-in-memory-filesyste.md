---
id: 01a16ded-8a52-7d5c-b651-dea1ff12c6b8
title: Joint test:all with suite reports and an in-memory FileSystem
ord: 26
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16e20-3dd6-7696-901e-d29696ccb336",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
The joint test:all with suite reports and an in-memory FileSystem stands delivered. Before under load: 126 groups, 162 chunks, wall 2400.73 s and CPU 2776.34 s; two interrupted runs included. c177525524 leaves the full deadline to the next suite instead of cutting at the slice's end. In a clean detached run verified: a missing Vitest root bin (2714480289), Bun exports window-behavior, and Node/Electron dist after install (531ea25154); consumers passed seeds 1/2/3. The machine budget added x-sqlite in d90f0a1523. What remains is a quiet measurement on the orchestrator's signal in detached HEAD: native artifacts prepared separately, then jobs3 with the machine budget and randomized seeds 1/2/3. Final totals never measured yet.
