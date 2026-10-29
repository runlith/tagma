---
id: 01a15681-0b8f-7067-bcf4-5138dd380bf6
title: "One mechanism — one implementation: repeated behaviour or UI is extracted into a shared component and reused, no second copy is written"
ord: 14
tags: ["rule"]
fields:
  {
    "delivery": "prompt"
  }
---
Covers all of runlith: tabs, lists, menus, drag-and-drop, seams, fades, stores, and any other mechanism. Before writing a mechanism, check whether it already exists; if it does, use it or extract it into a shared place and move all consumers onto it in the same change. Found two implementations of one mechanism — merge them into one in the work that found them.
