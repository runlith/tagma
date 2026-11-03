---
id: 01a1a281-0a21-7947-abc2-5378bc761e34
title: The installer's JSON stream contains only its placement
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/release-channel/cli.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/installer.ts
---
An installer can finish switching current while cleanup reports a warning. Diagnostics go to stderr so its JSON stdout remains one typed placement; a consumer rejects malformed output rather than guess a result from log lines, since exit zero can also mean held or ask.