---
id: 01a1941f-f2bb-77f3-9717-654e6b8cdc4b
title: Preserve tool argument bytes and model-visible catalog prefixes
ord: 207
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a13f20-667b-7e2a-9357-3d2d3db73bca
  - kind: relates
    to: 01a16ec6-1438-7cae-bd2c-33f17eff1d60
  - kind: relates
    to: 01a18781-32c0-7f74-b950-24635b7223ae
---
Investigate Unicode escape corruption, missing direct-tool definitions and fork prompt-cache divergence through the actual argument, offer and request-building boundaries. Compare exact serialized inputs and model payloads before editing; distinguish JSON syntax from changed string bytes and an admitted catalog from the actual offered definitions. Preserve fork facts and catalog policy, use deterministic captured requests rather than paid live provider calls, and fix only proven producer defects.