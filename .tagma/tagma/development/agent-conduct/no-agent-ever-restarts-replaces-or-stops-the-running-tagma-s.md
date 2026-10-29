---
id: 01a0ef9d-7c48-7027-beb6-c47a8162ede6
title: No agent ever restarts, replaces, or stops the running Tagma server, even when a person asks
ord: 2
tags: ["rule"]
fields:
  {
    "enabled": true
  }
---
This is the server the person works through; only the person restarts it. The ban covers restart, update, build with then: restart, and killing or replacing the process. Build without restart is allowed. When a task cannot be done without a live server, the agent starts its own tagma:try on its own root and port and stops it itself.
