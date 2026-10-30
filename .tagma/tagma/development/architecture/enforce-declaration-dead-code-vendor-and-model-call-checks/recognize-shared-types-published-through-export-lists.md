---
id: 01a18ecf-3054-7c6d-a377-b962cebd5fc0
title: Recognize shared types published through export lists
ord: 12
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
A type declared locally and published by an export list remains marked private in shape facts, hiding copies in production-dependent modules. Compute its public identity from the module's export list as well as declaration modifiers.