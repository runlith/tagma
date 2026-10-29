---
id: 01a14a2d-dba1-7be0-8d29-937e777ffe8d
title: tagma:try still dies pruning old releases with LaunchServices -10814
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "forgetBundles throws: LaunchServices kept 7 applications of install/20261017T063146617Z (-10814 from spotlight); the instance never starts and the root is unusable, so a fresh root (and a Chrome for Testing re-download) is the only way on.",
    "command": "bun run tagma:try --root /var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/tagma-try-managed --port 4815",
    "expected": "The try instance starts over its existing root, pruning stale releases quietly."
  }
---
Filed from project `runlith`.