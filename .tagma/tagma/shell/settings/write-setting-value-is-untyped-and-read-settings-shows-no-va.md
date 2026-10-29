---
id: 01a146b3-b04a-7cb1-96a4-077ca37da6e5
title: write_setting value is untyped and read_settings shows no value shape, so a list-of-objects key is guessed wrong
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "setting-value \"Expected object at [0]\"; the tool's value is an untyped {}, the catalog line prints only the current value and prose description, and the refusal's unblock repeats that prose without the form {type, to}",
    "command": "write_setting {key: \"agents.offered\", value: [\"tagma-shellread\", \"tagma-exp\"]}",
    "expected": "read_settings shows each key's value shape, and a setting-value refusal names the exact shape the key holds"
  }
---
Filed from project `runlith`.