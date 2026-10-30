---
id: 01a18ecf-30dd-7da0-a37b-c770b5d389e3
title: Detect vendor cursor comparisons under ordinary identifier names
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188ae-2d0b-74f2-91fc-f0e9ba085af5",
    "status": "done"
  }
---
The vendor-string check requires a vendor-role name before treating cursor as a vendor, so a feature's id === 'cursor' is missed. Prove the ordinary-id comparison while retaining the explicit non-vendor pagination and presentation cases.