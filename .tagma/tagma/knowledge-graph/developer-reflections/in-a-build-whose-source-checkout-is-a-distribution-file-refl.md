---
id: 01a19a15-36c4-778a-948f-bfaede5fcd4c
title: In a build whose source checkout is a distribution, file_reflection files a core operation's friction into the distribution's graph
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "It stood in project 42 under a941dfc7 runlith-private with \"module landing has no module card here\", and had to be moved by hand with a cross-project update_block",
    "command": "file_reflection {command: \"submit_work …\"} on a server installed from ~/runlith/runlith (dd2bd38), which carries the core as its tagma/ submodule registered as project 5",
    "expected": "The entry stands under the core's own card of the module declaring the operation (landing, 9543a701 in project 5)"
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-02T01:25:54.661Z, from dd2bd38.

The server's source project is now the distribution's root checkout, so the reflection's home is looked up there alone; the core's module cards live in the registered project whose checkout is that root's `tagma/` submodule. The same holds for every core operation filed from this build.