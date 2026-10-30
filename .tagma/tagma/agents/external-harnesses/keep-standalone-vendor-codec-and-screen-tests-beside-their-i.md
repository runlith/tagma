---
id: 01a18e9d-29a7-7446-997b-8c07840e8800
title: Keep standalone vendor codec and screen tests beside their implementation
ord: 205
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e90-ac7d-7af0-889b-2022d8e965b5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
---
Move package-owned Claude hook-codec, composer and screen-widget cases from the server into their package suites. Keep server tests for its verdict projection, input witnesses and screen presentation; server integration tests remain only where they exercise actual server installation behavior.