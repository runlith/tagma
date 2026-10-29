---
id: 01a17321-2895-71ed-b498-9b2cefc51f58
title: "Terminal history: turn points in the map, alignment at launch and right after the act, child fork, Tagma-record session, `history: session` on every CLI"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a172f2-8290-7163-b4cf-1a445497752f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17321-2895-71ed-b498-9b2711b4f93a
  - kind: waits-on
    to: 01a17321-2895-71ed-b498-9b2a6362d09a
  - kind: waits-on
    to: 01a17321-2895-71ed-b498-9b2b8dfdd83b
---
The terminal's `TransportHistory` (`fork`, `restore`, `reset`, `moved`) and one decision function in the launch path — a vendor cut, otherwise a new session seeded from the journal. This also covers:
- carrying the TUI composer text across the restart;
- a form step setting `history: 'session'` for existing threads;
- the exception in [[08a1944e]].
