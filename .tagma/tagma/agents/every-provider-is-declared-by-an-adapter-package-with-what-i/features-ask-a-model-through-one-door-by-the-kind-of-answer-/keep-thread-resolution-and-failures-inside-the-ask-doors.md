---
id: 01a18e93-24e0-7667-b5a8-10c3c8688384
title: Keep thread resolution and failures inside the ask doors
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e90-ac8f-7e3f-b6e5-5faf5fe88765",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
---
Move warm-copy model resolution into providers, normalize transport model failures at ThreadAsks, and preserve the shared refusal through title and recap callers. ThreadAsks currently constructs a request to inspect its binding, and recap replaces provider refusals with a feature-specific failure.