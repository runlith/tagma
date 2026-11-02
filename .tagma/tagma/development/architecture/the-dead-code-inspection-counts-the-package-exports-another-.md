---
id: 01a199b8-36ad-7a89-9778-028d901c8da3
title: The dead-code inspection counts the package exports another root imports as production consumers
ord: 36
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
A root in another repository composes the core through the `exports` maps of `@tagma/server` and `@tagma/app`, so an export that only such a root's modules use has a production caller this repository cannot see. The `dead-code` inspection behind [[aabef712]] reads callers inside this repository alone and refuses such exports, although the rule counts a published package entry as a production consumer. Seen when the core stopped carrying two modules another root now composes: speech's capture helpers, graph tracking functions, `reachField`, the staged-thread types and others became debt under this task. Make the inspection count every file a package `exports` entry reaches, explicit or pattern, as consumed; then retire this debt.