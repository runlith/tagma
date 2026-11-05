---
id: 01a1ad83-ac51-7601-958f-f8d208f10719
title: The inspection kit owns calibration, admission and the budget; each runtime only times its probe
ord: 63
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1ad70-d091-79cc-bbfa-be4242c14db2",
    "status": "in_work"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/calibration.ts
  - kind: file
    ref: apps/tagma/inspection/src/core/node/run.ts
---
The server's inspections worker and the inspection CLI each decided for themselves whether a calibrated builtin needs a probe, which files it samples, what the judged subject measures, whether that subject is admitted and how its budget is built, and the two disagreed: the worker admitted every prefetching ask, the CLI only a reach; the CLI skipped calibration where an envelope was declared, the worker preferred the calibration; a remembered calibration was reused without the fit check a stored one had. The inspection kit owns all of it — the decision between no calibration, a known one that still fits, and a probe; the subject; admission; the one budget builder over builtin and calibration — through a probe-side contract (object and size per path) both runtimes fill from their own sides. Each runtime keeps only the timed read of the probe it is handed: the worker's async git-backed read with its stored and remembered calibrations, the CLI's synchronous fetch-and-parse.