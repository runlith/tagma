---
id: 01a12c96-b98a-721c-ba13-b9300fa91a70
title: update_block fails with ENOTEMPTY on rename when the target slug directory already exists
ord: 26
tags: ["reflection"]
fields:
  {
    "actual": "update_block refused ENOTEMPTY because the target slug directory already exists; title not applied after two attempts",
    "command": "update_block 6cc306ce title \"Installing Tagma on the machine\"",
    "expected": "The block title updates; the graph file storage follows it without name collisions"
  }
---
Filed from project `runlith`.