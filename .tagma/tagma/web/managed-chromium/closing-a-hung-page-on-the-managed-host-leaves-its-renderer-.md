---
id: 01a1855c-d36a-7f09-b4db-921ceb90c26a
title: Closing a hung page on the managed host leaves its renderer spinning a CPU core
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18433-d315-73f4-812d-a71e5c06e846",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046de2a2ecf8
---
Observed 2026-10-29 in the engine itest (Chrome for Testing 151, macOS, one sample): after a scenario that hangs a main-frame renderer with an infinite loop closed its page, the renderer was still at 96.7 % CPU 12 s later; `Target.closeTarget` does not stop a busy renderer, and a later page of the same site was handed the same renderer and refused `page-unresponsive`. For a user this is a core burned until the profile process exits after its idle bound, and a poisoned site for the agent's next pages. When `close_page` closes a page the engine holds unresponsive and the host can prove its renderer serves no other live page, end that renderer (main-frame `Page.crash` on the page's own session is handled off the hung thread); otherwise keep today's behaviour and name it. Prove with a scenario: a hung page closed, a fresh page of the same site works and no renderer of the closed page outlives the close.