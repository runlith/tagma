---
id: 01a1a7c1-a301-72eb-a9c9-31c8f8bd7327
title: Bun platform test files are selected before their modules load
ord: 34
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/cli.ts
  - kind: file
    ref: packages/testbed/src/core/files.ts
---
An adapter module may fail merely by loading on another OS, so its platform suffix is judged by the runner before import rather than by a test's skip condition. A suffix may name several supported platforms; an unmarked file remains shared. This selection applies both to discovery and to named Bun files, including a selection consisting entirely of foreign-platform files.

`TESTBED_PLATFORM_ONLY=1` leaves the unmarked files out as well, so a run takes only the files marked for its own platform. A platform's runner uses it to run that platform's adapter tests alone, while shared code is proven on Linux. A selection with no file marked for the platform ends as a SKIP with exit 0, like one made only of foreign files.