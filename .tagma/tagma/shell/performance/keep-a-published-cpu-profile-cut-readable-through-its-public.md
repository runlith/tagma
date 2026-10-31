---
id: 01a1941f-f2bb-77f3-9717-6551c6976cf6
title: Keep a published CPU-profile cut readable through its public reader
ord: 47
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd90-73db-9615-8771d5cafaa8",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a190c4-acfe-7d01-807a-6f2434bf0b53
---
Investigate the durable CPU-profile record reported unreadable immediately after capture. Reproduce publication and read ordering through CpuProfiles and PerformanceReports in an isolated fixture, fix a proven durability defect at its owner, and distinguish a lost historical fixture from proof of a current failure. Do not change capture policy or launch a live product.