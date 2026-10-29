---
id: 01a0eee4-9329-73ce-a90f-04f999b5c911
title: The app's browser bundle reaches no Node built-in, including third-party files
ord: 4
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: .
---
Every browser app, including a new one, wires @runlith/vite-browser-guard in its own Vite config. A client build that reaches a Node built-in in our or third-party code fails and shows the chain to the page.
