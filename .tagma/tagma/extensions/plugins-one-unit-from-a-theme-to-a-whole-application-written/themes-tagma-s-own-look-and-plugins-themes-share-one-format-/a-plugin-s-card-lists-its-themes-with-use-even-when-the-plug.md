---
id: 01a1b20a-5d25-73c5-8b32-7e32fe18d920
title: A plugin's card lists its themes with Use even when the plugin runs nowhere
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1b110-e4ac-7664-8239-25b90aaf5ade",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a1b124-db79-7d5f-8149-70c5ca575591
---
The plugin's row carries the themes its manifest declares, read by the server, so the card lists them whether or not the plugin runs anywhere. Use on a plugin that runs nowhere turns it on for all the person's projects and chooses the theme in the same act (spec d2b5f488, The Plugins screen).