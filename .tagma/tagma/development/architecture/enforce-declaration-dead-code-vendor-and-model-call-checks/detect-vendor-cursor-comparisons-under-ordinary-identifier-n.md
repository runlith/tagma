---
id: 01a18ecf-30dd-7da0-a37b-c770b5d389e3
title: Detect vendor cursor comparisons under ordinary identifier names
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e91-0057-7f4b-85b6-a35adafffddb",
    "status": "in_work"
  }
---
The vendor-string check requires a vendor-role name before treating cursor as a vendor, so a feature's id === 'cursor' is missed. Prove the ordinary-id comparison while retaining the explicit non-vendor pagination and presentation cases.