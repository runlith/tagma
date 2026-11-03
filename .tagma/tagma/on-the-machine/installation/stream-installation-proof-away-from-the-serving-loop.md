---
id: 01a1a257-33c8-716c-a949-a334cc97ca87
title: Stream installation proof away from the serving loop
ord: 64
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a256-8f22-7269-86e8-731b8c64af1d",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
---
Replace whole-file synchronous installation verification with bounded streaming proof off the serving loop, preserving typed installation failures and FileSystem adapters. Prove the release verification caller contract red before green.