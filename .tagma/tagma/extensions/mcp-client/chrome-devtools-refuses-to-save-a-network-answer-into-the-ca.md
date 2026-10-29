---
id: 01a130cf-c220-7405-8f8e-9dfda580d3ac
title: Chrome DevTools refuses to save a network answer into the calling thread's scratch
ord: 23
tags: ["reflection"]
fields:
  {
    "actual": "Tool returned Error: Access denied: path … is not within any of the configured workspace roots; the issued scratch was rejected.",
    "command": "mcp__chrome-devtools__get_network_request({pageId:8, reqid:5})",
    "expected": "Read the network request and save the large answer in this thread's scratch."
  }
---
Filed from project `runlith`.
