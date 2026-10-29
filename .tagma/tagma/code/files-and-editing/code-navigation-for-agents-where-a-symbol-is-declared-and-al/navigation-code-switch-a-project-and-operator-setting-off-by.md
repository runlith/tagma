---
id: 01a1645d-7ada-7da6-b3bc-c5b6b9149afa
title: "Navigation code switch: a project and operator setting, off by default"
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1645d-c45f-7e69-a397-5f1c4ce13b50",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
Operator decision (spec, "Switch" item): navigation is switched on and off by a setting — for the project and for all of the operator's projects, off by default. Reason: a live measurement after restart — an idle runlith engine with no questions steadily eats 1–3 cores (104 s CPU in 68 s) and 7–8 GB, lagging 55–137 files behind, because it recomputes on every checkout change and rebuilds all programs on every HEAD shift. When off: no engine process exists and nothing raises one; `definition`/`uses` are not offered to agents (new threads never get them, working ones lose them on the next step); a call reaching the operation anyway is refused with "navigation off". Switching on returns the tools with no server restart.
