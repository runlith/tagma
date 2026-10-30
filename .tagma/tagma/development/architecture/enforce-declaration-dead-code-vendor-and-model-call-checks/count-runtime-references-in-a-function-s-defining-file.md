---
id: 01a18ecf-2fdd-7c12-bc9e-10f80dad2830
title: Count runtime references in a function's defining file
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188ae-2d0b-74f2-91fc-f0e9ba085af5",
    "status": "done"
  }
---
A function imported only in type positions is reported uncalled even when production code in its defining file calls it. Record local runtime references without treating declaration names, metadata reads or shadowed bindings as callers.