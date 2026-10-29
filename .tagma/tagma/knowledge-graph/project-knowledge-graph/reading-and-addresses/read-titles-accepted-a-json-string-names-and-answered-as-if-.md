---
id: 01a14169-263c-7585-974a-6fb960851f17
title: read_titles accepted a JSON-string `names` and answered as if it named one block called `["3b931e76"]`
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "The call ran with names = [\"[\\\"3b931e76\\\"]\"] and answered titles: [] plus ten unreadable copies of another project listing that literal name — a valid-looking 'not found' for a block that exists in global; cost one misleading diagnosis step",
    "command": "mcp__tagma__read_titles {\"names\": \"[\\\"3b931e76\\\"]\"} (deferred tool called before its schema was loaded, so the array arrived as a string)",
    "expected": "A field-shape refusal naming `names` as not an array, or the string parsed as the array it encodes"
  }
---
Filed from project `runlith`.