---
id: 01a146b3-b002-7843-b99c-f05ff5cefe48
title: "read_settings section \"agents\" refused: keys agents.* live in section agent beside agent.* keys"
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "field-invalid \"no settings section is named agents\"; agents.offered, agents.default, agents.web, agents.modelGuidance are declared in section agent. The same split stands for files.* (section editor) and performance.* (section telemetry)",
    "command": "read_settings {section: \"agents\"}",
    "expected": "A key's first segment is its section, so the section named by agents.offered answers"
  }
---
Filed from project `runlith`.