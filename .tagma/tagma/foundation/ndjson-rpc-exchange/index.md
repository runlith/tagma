---
id: 01a0c6ef-8083-763c-a499-dea0ffc6963b
title: NDJSON-RPC exchange
ord: 1
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/exchange.ts",
        "for": [
          "287a4906",
          "ad88de8a",
          "b6853ec2",
          "3c2426a1"
        ]
      },
      {
        "at": "src/envelope.ts",
        "for": [
          "287a4906",
          "ad88de8a",
          "7c50fada",
          "b6853ec2"
        ]
      }
    ],
    "id": "@runlith/ndjson-rpc",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
sources:
  - kind: dir
    ref: packages/ndjson-rpc
---
Runlith talks to vendor servers over JSON-RPC on top of their stdio bytes, and this is the shared core to which each road — capture, harness preparation, and ACP — attaches its live execution. The package owns line framing with a caller-set ceiling, both-direction envelope parsing (request, notification, result, error), frame writing, a typed failure dictionary, and a request–response dialogue with a single pending request and a transcript in which only the notification count is bounded. Starting and stopping the server, the bytes themselves, matching many pending requests, and the meaning of any message stay with the caller.
